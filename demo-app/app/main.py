from __future__ import annotations

import asyncio
import re
from collections import Counter
from dataclasses import asdict
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Optional

import httpx
from fastapi import FastAPI, Request, Response
from fastapi.responses import HTMLResponse, JSONResponse, PlainTextResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates

from .clients import ActionRunnerClient, AlertmanagerClient, LokiClient
from .config import Settings
from .logging_json import make_json_logger
from .metrics import Metrics, client_ip, metrics_middleware
from .obs import fetch_logs, summarize_entries
from .rate_limit import SlidingWindowRateLimiter, rate_limit_response

BASE_DIR = Path(__file__).resolve().parent
TEMPLATES_DIR = BASE_DIR / "templates"
STATIC_DIR = BASE_DIR / "static"

_URL_RE = re.compile(r"https?://[^\s]+", re.IGNORECASE)
_IPV4_RE = re.compile(r"\b(?:\d{1,3}\.){3}\d{1,3}\b")
_HOSTPORT_RE = re.compile(r"\b[a-zA-Z0-9._-]+:\d{2,5}\b")
_INTERNAL_WORDS_RE = re.compile(
    r"\b(?:alertmanager|loki|prometheus|grafana|tg-relay|demo-app|action-runner|localhost|host\.docker\.internal)\b",
    re.IGNORECASE,
)

WINDOW_TO_DELTA: dict[str, timedelta] = {
    "1h": timedelta(hours=1),
    "6h": timedelta(hours=6),
    "24h": timedelta(hours=24),
}
DEFAULT_WINDOW = "24h"


def create_app() -> FastAPI:
    settings = Settings.load()
    app = FastAPI(title=settings.app_name)

    app.mount("/static", StaticFiles(directory=str(STATIC_DIR)), name="static")
    templates = Jinja2Templates(directory=str(TEMPLATES_DIR))

    json_log = make_json_logger(service=settings.app_name, env=settings.env)
    metrics = Metrics(service=settings.app_name)
    limiter = SlidingWindowRateLimiter(limit=settings.rate_limit, window_s=settings.rate_window_s)

    def _now_utc() -> datetime:
        return datetime.now(timezone.utc)

    def _parse_iso_ts(value: Any) -> Optional[datetime]:
        if value is None:
            return None

        text = str(value).strip()
        if not text:
            return None

        for candidate in (
            text,
            text[:-1] + "+00:00" if text.endswith("Z") else None,
        ):
            if not candidate:
                continue
            try:
                dt = datetime.fromisoformat(candidate)
                if dt.tzinfo is None:
                    dt = dt.replace(tzinfo=timezone.utc)
                return dt.astimezone(timezone.utc)
            except Exception:
                pass

        try:
            dt = datetime.strptime(text, "%Y-%m-%d %H:%M:%S UTC")
            return dt.replace(tzinfo=timezone.utc)
        except Exception:
            return None

    def _age_seconds_from_dt(dt: Optional[datetime]) -> Optional[int]:
        if dt is None:
            return None
        return max(0, int((_now_utc() - dt).total_seconds()))

    def _safe_window(raw: str) -> str:
        return raw if raw in WINDOW_TO_DELTA else DEFAULT_WINDOW

    def _window_start(window: str) -> datetime:
        return _now_utc() - WINDOW_TO_DELTA[_safe_window(window)]

    def _sort_recent(items: list[dict[str, Any]]) -> list[dict[str, Any]]:
        def sort_key(item: dict[str, Any]) -> tuple[float, int]:
            dt = (
                _parse_iso_ts(item.get("created_at"))
                or _parse_iso_ts(item.get("started_at"))
                or _parse_iso_ts(item.get("finished_at"))
            )
            ts = dt.timestamp() if dt else 0.0
            try:
                item_id = int(item.get("id") or 0)
            except Exception:
                item_id = 0
            return ts, item_id

        return sorted(items, key=sort_key, reverse=True)

    def _status_counts(items: list[dict[str, Any]]) -> dict[str, int]:
        counter: Counter[str] = Counter()
        for item in items:
            status = str(item.get("status") or "unknown").strip().lower() or "unknown"
            counter[status] += 1
        return dict(sorted(counter.items()))

    def _filter_by_window(items: list[dict[str, Any]], window: str) -> list[dict[str, Any]]:
        start_dt = _window_start(window)
        out: list[dict[str, Any]] = []
        for item in items:
            dt = (
                _parse_iso_ts(item.get("created_at"))
                or _parse_iso_ts(item.get("started_at"))
                or _parse_iso_ts(item.get("finished_at"))
            )
            if dt is None:
                continue
            if dt >= start_dt:
                out.append(item)
        return out

    def _filter_tasks(items: list[dict[str, Any]], *, window: str, status: str) -> list[dict[str, Any]]:
        out = _filter_by_window(items, window)
        if status != "all":
            out = [item for item in out if str(item.get("status") or "").lower() == status]
        return _sort_recent(out)

    def _filter_decisions(items: list[dict[str, Any]], *, window: str, decision_type: str) -> list[dict[str, Any]]:
        out = _filter_by_window(items, window)
        if decision_type != "all":
            out = [item for item in out if str(item.get("decision") or "").lower() == decision_type]
        return _sort_recent(out)

    def _filter_runs(items: list[dict[str, Any]], *, window: str, status: str) -> list[dict[str, Any]]:
        out = _filter_by_window(items, window)
        if status != "all":
            out = [item for item in out if str(item.get("status") or "").lower() == status]
        return _sort_recent(out)

    def _sanitize_text(value: Any, *, max_len: int = 120) -> Optional[str]:
        if value is None:
            return None
        text = str(value).strip()
        if not text:
            return None

        text = _URL_RE.sub("[redacted-url]", text)
        text = _IPV4_RE.sub("[redacted-ip]", text)
        text = _HOSTPORT_RE.sub("[redacted-hostport]", text)
        text = _INTERNAL_WORDS_RE.sub("[redacted]", text)
        text = " ".join(text.split())

        if len(text) > max_len:
            return text[: max_len - 1] + "…"
        return text

    def _sanitize_health(health: dict[str, Any]) -> dict[str, Any]:
        return {
            "status": str(health.get("status") or "unknown"),
            "service": "action-runner",
            "rules_loaded": int(health.get("rules_loaded", 0) or 0),
        }

    def _sanitize_task(task: dict[str, Any]) -> dict[str, Any]:
        created_dt = _parse_iso_ts(task.get("created_at"))
        started_dt = _parse_iso_ts(task.get("started_at"))
        finished_dt = _parse_iso_ts(task.get("finished_at"))
        return {
            "id": task.get("id"),
            "task_type": task.get("task_type"),
            "status": task.get("status"),
            "priority": task.get("priority"),
            "decision_id": task.get("decision_id"),
            "created_at": task.get("created_at"),
            "started_at": task.get("started_at"),
            "finished_at": task.get("finished_at"),
            "created_age_s": _age_seconds_from_dt(created_dt),
            "started_age_s": _age_seconds_from_dt(started_dt),
            "finished_age_s": _age_seconds_from_dt(finished_dt),
            "has_error": bool(task.get("error")),
            "has_result": bool(task.get("result_json") or task.get("result")),
        }

    def _sanitize_decision(decision: dict[str, Any]) -> dict[str, Any]:
        created_dt = _parse_iso_ts(decision.get("created_at"))
        return {
            "id": decision.get("id"),
            "created_at": decision.get("created_at"),
            "created_age_s": _age_seconds_from_dt(created_dt),
            "status": decision.get("status"),
            "severity": decision.get("severity"),
            "alertname": _sanitize_text(decision.get("alertname"), max_len=48),
            "decision": decision.get("decision"),
            "action": _sanitize_text(decision.get("action"), max_len=48),
            "reason": _sanitize_text(decision.get("reason"), max_len=72),
        }

    def _sanitize_run(run: dict[str, Any]) -> dict[str, Any]:
        started_dt = _parse_iso_ts(run.get("started_at"))
        finished_dt = _parse_iso_ts(run.get("finished_at"))
        return {
            "id": run.get("id"),
            "action": _sanitize_text(run.get("action"), max_len=48),
            "status": run.get("status"),
            "trigger_type": run.get("trigger_type"),
            "started_at": run.get("started_at"),
            "finished_at": run.get("finished_at"),
            "started_age_s": _age_seconds_from_dt(started_dt),
            "finished_age_s": _age_seconds_from_dt(finished_dt),
            "has_error": bool(run.get("error")),
        }

    def _format_age(seconds: Optional[int]) -> str:
        if seconds is None:
            return "unknown"
        if seconds < 60:
            return f"{seconds}s ago"
        minutes = seconds // 60
        if minutes < 60:
            return f"{minutes}m ago"
        hours = minutes // 60
        if hours < 24:
            return f"{hours}h ago"
        days = hours // 24
        return f"{days}d ago"

    def _queue_state(queue_depth: Optional[float]) -> str:
        if queue_depth is None:
            return "unknown"
        if queue_depth <= 0:
            return "idle"
        if queue_depth < 5:
            return "active"
        return "busy"

    def _human_summary(
        *,
        health: dict[str, Any],
        tasks: list[dict[str, Any]],
        decisions: list[dict[str, Any]],
        runs: list[dict[str, Any]],
        queue_depth: Optional[float],
    ) -> dict[str, Any]:
        runner_ok = str(health.get("status") or "").lower() == "ok"
        task_status = _status_counts(tasks)
        run_status = _status_counts(runs)
        failures = int(task_status.get("failed", 0)) + int(run_status.get("failed", 0))
        last_decision = _sort_recent(decisions)[:1]
        last_task = _sort_recent(tasks)[:1]
        last_run = _sort_recent(runs)[:1]

        latest_age_candidates = [
            _age_seconds_from_dt(_parse_iso_ts(last_decision[0].get("created_at"))) if last_decision else None,
            _age_seconds_from_dt(_parse_iso_ts(last_task[0].get("created_at"))) if last_task else None,
            _age_seconds_from_dt(_parse_iso_ts(last_run[0].get("started_at"))) if last_run else None,
        ]
        latest_age_candidates = [value for value in latest_age_candidates if value is not None]
        last_activity_age = min(latest_age_candidates) if latest_age_candidates else None

        if not runner_ok:
            level = "degraded"
            message = "Runner is unavailable. Control-plane data may be stale."
        elif failures > 0:
            level = "warning"
            message = f"Recent activity detected with {failures} failure(s) in the pipeline."
        elif not decisions and not tasks and not runs:
            level = "idle"
            message = "Runner is healthy, but no recent pipeline activity was detected."
        else:
            level = "healthy"
            message = "Runner is healthy and recent pipeline activity was detected."

        return {
            "level": level,
            "message": message,
            "last_activity_age_s": last_activity_age,
            "last_activity_human": _format_age(last_activity_age),
            "queue_state": _queue_state(queue_depth),
            "failures": failures,
        }

    async def _queue_depth_value() -> Optional[float]:
        try:
            response = await app.state.http.get(f"{settings.action_runner_url}/metrics", timeout=2.5)
            response.raise_for_status()
            total = 0.0
            seen = False
            for line in response.text.splitlines():
                if not line or line.startswith("#"):
                    continue
                if line.startswith("action_runner_queue_depth"):
                    parts = line.split()
                    if len(parts) >= 2:
                        try:
                            total += float(parts[-1])
                            seen = True
                        except ValueError:
                            pass
            return total if seen else None
        except Exception:
            return None

    def _summary_payload(
        *,
        window: str,
        health: dict[str, Any],
        tasks: list[dict[str, Any]],
        decisions: list[dict[str, Any]],
        runs: list[dict[str, Any]],
        queue_depth: Optional[float],
    ) -> dict[str, Any]:
        tasks_recent = _sort_recent(tasks)
        decisions_recent = _sort_recent(decisions)
        runs_recent = _sort_recent(runs)

        sanitized_health = _sanitize_health(health)
        human = _human_summary(
            health=sanitized_health,
            tasks=tasks,
            decisions=decisions,
            runs=runs,
            queue_depth=queue_depth,
        )

        return {
            "ok": True,
            "window": window,
            "runner": sanitized_health,
            "human_status": human,
            "totals": {
                "tasks": len(tasks),
                "decisions": len(decisions),
                "runs": len(runs),
                "failures": human["failures"],
            },
            "queue": {
                "depth": queue_depth,
                "state": human["queue_state"],
            },
            "task_status_counts": _status_counts(tasks),
            "run_status_counts": _status_counts(runs),
            "last_task": _sanitize_task(tasks_recent[0]) if tasks_recent else None,
            "last_decision": _sanitize_decision(decisions_recent[0]) if decisions_recent else None,
            "last_run": _sanitize_run(runs_recent[0]) if runs_recent else None,
        }

    @app.on_event("startup")
    async def _startup() -> None:
        app.state.http = httpx.AsyncClient(timeout=httpx.Timeout(settings.http_timeout_s))
        app.state.alerts = AlertmanagerClient(app.state.http, settings.alertmanager_url)
        app.state.loki = LokiClient(app.state.http, settings.loki_url, tenant=settings.loki_tenant)
        app.state.runner = ActionRunnerClient(app.state.http, settings.action_runner_url)

    @app.on_event("shutdown")
    async def _shutdown() -> None:
        await app.state.http.aclose()

    app.middleware("http")(metrics_middleware(metrics, json_log))

    @app.get("/", response_class=HTMLResponse)
    async def index(request: Request):
        ctx = {
            "request": request,
            "app_name": settings.app_name,
            "env": settings.env,
            "endpoints": [
                {"name": "health", "method": "GET", "path": "/healthz", "descr": "healthcheck"},
                {"name": "ready", "method": "GET", "path": "/readyz", "descr": "readiness (deps check)"},
                {"name": "version", "method": "GET", "path": "/version", "descr": "build version"},
                {"name": "metrics", "method": "GET", "path": "/metrics", "descr": "Prometheus scrape"},
                {"name": "slow", "method": "GET", "path": "/slow?ms=500", "descr": "latency demo"},
                {"name": "error", "method": "GET", "path": "/error?code=503", "descr": "error demo"},
                {"name": "obs_alerts", "method": "GET", "path": "/_obs/alerts", "descr": "Alertmanager API (read)"},
                {"name": "obs_logs", "method": "GET", "path": "/_obs/logs?mode=buttons&limit=20", "descr": "Loki logs (filtered)"},
                {"name": "control_plane", "method": "GET", "path": "/control-plane", "descr": "action-runner read-only UI"},
            ],
        }
        return templates.TemplateResponse("index.html", ctx)

    @app.get("/control-plane", response_class=HTMLResponse)
    async def control_plane(request: Request):
        if not settings.control_plane_enabled:
            return Response("control-plane disabled\n", status_code=404, media_type="text/plain")

        ctx = {
            "request": request,
            "app_name": settings.app_name,
            "env": settings.env,
            "page_title": f"{settings.app_name} / control-plane",
        }
        return templates.TemplateResponse("control_plane.html", ctx)

    @app.get("/healthz", response_class=PlainTextResponse)
    async def healthz():
        return "ok"

    @app.get("/version", response_class=PlainTextResponse)
    async def version():
        return settings.app_version

    @app.get("/readyz", response_class=PlainTextResponse)
    async def readyz():
        urls = settings.ready_urls
        if not urls:
            return "READY\n"

        async def _check(url: str) -> tuple[str, bool, str]:
            try:
                r = await app.state.http.get(url, timeout=2.0)
                ok = 200 <= r.status_code < 400
                return url, ok, f"http={r.status_code}"
            except Exception as e:
                return url, False, str(e)

        results = await asyncio.gather(*(_check(u) for u in urls))
        bad = [(u, msg) for (u, ok, msg) in results if not ok]

        if bad:
            details = "\n".join([f"- {u}: {msg}" for (u, msg) in bad])
            return Response(
                f"NOT READY\n{details}\n",
                status_code=503,
                media_type="text/plain",
            )

        return "READY\n"

    @app.get("/metrics")
    async def metrics_endpoint():
        return metrics.metrics_response()

    @app.get("/slow", response_class=PlainTextResponse)
    async def slow(request: Request, ms: int = 250):
        deny = rate_limit_response(await limiter.check(request, "danger"))
        if deny is not None:
            return deny

        if ms < 0 or ms > 30_000:
            return Response("ms must be 0..30000\n", status_code=400, media_type="text/plain")

        metrics.app_forced_latency_total.labels(service=settings.app_name).inc()
        await asyncio.sleep(ms / 1000.0)

        json_log("forced_slow", ms=ms, client_ip=client_ip(request))
        return f"slept {ms}ms\n"

    @app.get("/error")
    async def error(request: Request, code: int = 500, msg: Optional[str] = None):
        deny = rate_limit_response(await limiter.check(request, "danger"))
        if deny is not None:
            return deny

        if code < 400 or code > 599:
            return Response("code must be 400..599\n", status_code=400, media_type="text/plain")

        metrics.app_forced_errors_total.labels(service=settings.app_name, code=str(code)).inc()
        body = (msg or f"forced error {code}") + "\n"
        json_log("forced_error", code=code, msg=msg)
        return Response(body, status_code=code, media_type="text/plain")

    @app.get("/_obs/alerts")
    async def obs_alerts():
        try:
            alerts = await app.state.alerts.get_alerts()
            return {"ok": True, "count": len(alerts), "alerts": [asdict(a) for a in alerts]}
        except Exception as e:
            return {"ok": False, "error": str(e)}

    @app.get("/_obs/logs")
    async def obs_logs(mode: str = "buttons", limit: int = 30):
        try:
            entries, query = await fetch_logs(settings, app.state.loki, mode=mode, limit=limit)
            return {
                "ok": True,
                "mode": mode,
                "query": query,
                "count": len(entries),
                "summary": summarize_entries(entries),
                "entries": [asdict(e) for e in entries],
            }
        except Exception as e:
            return {"ok": False, "error": str(e)}

    @app.get("/api/control-plane/healthz")
    async def control_plane_healthz():
        if not settings.control_plane_enabled:
            return JSONResponse({"ok": False, "error": "control-plane disabled"}, status_code=404)

        try:
            health = await app.state.runner.get_health()
            return {"ok": True, "health": _sanitize_health(health)}
        except Exception:
            return JSONResponse({"ok": False, "error": "runner unavailable"}, status_code=502)

    @app.get("/api/control-plane/tasks")
    async def control_plane_tasks(
        window: str = DEFAULT_WINDOW,
        task_status: str = "all",
        limit: int = 50,
    ):
        if not settings.control_plane_enabled:
            return JSONResponse({"ok": False, "error": "control-plane disabled"}, status_code=404)

        safe_window = _safe_window(window)
        safe_limit = max(1, min(limit, 200))
        safe_status = str(task_status or "all").strip().lower() or "all"

        try:
            tasks = await app.state.runner.get_tasks()
            filtered = _filter_tasks(tasks, window=safe_window, status=safe_status)
            public_tasks = [_sanitize_task(item) for item in filtered[:safe_limit]]
            return {
                "ok": True,
                "window": safe_window,
                "task_status": safe_status,
                "count": len(filtered),
                "tasks": public_tasks,
            }
        except Exception:
            return JSONResponse({"ok": False, "error": "runner unavailable"}, status_code=502)

    @app.get("/api/control-plane/decisions")
    async def control_plane_decisions(
        window: str = DEFAULT_WINDOW,
        decision_type: str = "all",
        limit: int = 50,
    ):
        if not settings.control_plane_enabled:
            return JSONResponse({"ok": False, "error": "control-plane disabled"}, status_code=404)

        safe_window = _safe_window(window)
        safe_limit = max(1, min(limit, 200))
        safe_decision_type = str(decision_type or "all").strip().lower() or "all"

        try:
            decisions = await app.state.runner.get_decisions()
            filtered = _filter_decisions(decisions, window=safe_window, decision_type=safe_decision_type)
            public_decisions = [_sanitize_decision(item) for item in filtered[:safe_limit]]
            return {
                "ok": True,
                "window": safe_window,
                "decision_type": safe_decision_type,
                "count": len(filtered),
                "decisions": public_decisions,
            }
        except Exception:
            return JSONResponse({"ok": False, "error": "runner unavailable"}, status_code=502)

    @app.get("/api/control-plane/runs")
    async def control_plane_runs(
        window: str = DEFAULT_WINDOW,
        run_status: str = "all",
        limit: int = 50,
    ):
        if not settings.control_plane_enabled:
            return JSONResponse({"ok": False, "error": "control-plane disabled"}, status_code=404)

        safe_window = _safe_window(window)
        safe_limit = max(1, min(limit, 200))
        safe_status = str(run_status or "all").strip().lower() or "all"

        try:
            runs = await app.state.runner.get_runs()
            filtered = _filter_runs(runs, window=safe_window, status=safe_status)
            public_runs = [_sanitize_run(item) for item in filtered[:safe_limit]]
            return {
                "ok": True,
                "window": safe_window,
                "run_status": safe_status,
                "count": len(filtered),
                "runs": public_runs,
            }
        except Exception:
            return JSONResponse({"ok": False, "error": "runner unavailable"}, status_code=502)

    @app.get("/api/control-plane/summary")
    async def control_plane_summary(window: str = DEFAULT_WINDOW):
        if not settings.control_plane_enabled:
            return JSONResponse({"ok": False, "error": "control-plane disabled"}, status_code=404)

        safe_window = _safe_window(window)

        try:
            health, tasks, decisions, runs, queue_depth = await asyncio.gather(
                app.state.runner.get_health(),
                app.state.runner.get_tasks(),
                app.state.runner.get_decisions(),
                app.state.runner.get_runs(),
                _queue_depth_value(),
            )

            filtered_tasks = _filter_tasks(tasks, window=safe_window, status="all")
            filtered_decisions = _filter_decisions(decisions, window=safe_window, decision_type="all")
            filtered_runs = _filter_runs(runs, window=safe_window, status="all")

            return _summary_payload(
                window=safe_window,
                health=health,
                tasks=filtered_tasks,
                decisions=filtered_decisions,
                runs=filtered_runs,
                queue_depth=queue_depth,
            )
        except Exception:
            return JSONResponse({"ok": False, "error": "runner unavailable"}, status_code=502)

    return app


app = create_app()
