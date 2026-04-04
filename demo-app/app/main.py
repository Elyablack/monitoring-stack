from __future__ import annotations

import asyncio
from collections import Counter
from dataclasses import asdict
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


def create_app() -> FastAPI:
    settings = Settings.load()
    app = FastAPI(title=settings.app_name)

    app.mount("/static", StaticFiles(directory=str(STATIC_DIR)), name="static")
    templates = Jinja2Templates(directory=str(TEMPLATES_DIR))

    json_log = make_json_logger(service=settings.app_name, env=settings.env)
    metrics = Metrics(service=settings.app_name)
    limiter = SlidingWindowRateLimiter(limit=settings.rate_limit, window_s=settings.rate_window_s)

    def _sort_recent(items: list[dict[str, Any]]) -> list[dict[str, Any]]:
        def sort_key(item: dict[str, Any]) -> tuple[str, int]:
            created_at = str(
                item.get("created_at")
                or item.get("started_at")
                or item.get("finished_at")
                or ""
            )
            raw_id = item.get("id")
            try:
                item_id = int(raw_id)
            except Exception:
                item_id = 0
            return created_at, item_id

        return sorted(items, key=sort_key, reverse=True)

    def _status_counts(items: list[dict[str, Any]]) -> dict[str, int]:
        counter: Counter[str] = Counter()
        for item in items:
            status = str(item.get("status") or "unknown").strip().lower() or "unknown"
            counter[status] += 1
        return dict(sorted(counter.items()))

    def _summary_payload(
        *,
        health: dict[str, Any],
        tasks: list[dict[str, Any]],
        decisions: list[dict[str, Any]],
        runs: list[dict[str, Any]],
    ) -> dict[str, Any]:
        tasks_recent = _sort_recent(tasks)
        decisions_recent = _sort_recent(decisions)
        runs_recent = _sort_recent(runs)

        return {
            "ok": True,
            "runner": {
                "status": health.get("status", "unknown"),
                "service": health.get("service", "action-runner"),
                "rules_loaded": int(health.get("rules_loaded", 0) or 0),
            },
            "totals": {
                "tasks": len(tasks),
                "decisions": len(decisions),
                "runs": len(runs),
            },
            "task_status_counts": _status_counts(tasks),
            "run_status_counts": _status_counts(runs),
            "last_task": tasks_recent[0] if tasks_recent else None,
            "last_decision": decisions_recent[0] if decisions_recent else None,
            "last_run": runs_recent[0] if runs_recent else None,
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
            return {"ok": True, "health": health}
        except Exception as e:
            return JSONResponse({"ok": False, "error": str(e)}, status_code=502)

    @app.get("/api/control-plane/tasks")
    async def control_plane_tasks(limit: int = 50):
        if not settings.control_plane_enabled:
            return JSONResponse({"ok": False, "error": "control-plane disabled"}, status_code=404)

        safe_limit = max(1, min(limit, 200))
        try:
            tasks = _sort_recent(await app.state.runner.get_tasks())
            return {"ok": True, "count": len(tasks), "tasks": tasks[:safe_limit]}
        except Exception as e:
            return JSONResponse({"ok": False, "error": str(e)}, status_code=502)

    @app.get("/api/control-plane/decisions")
    async def control_plane_decisions(limit: int = 50):
        if not settings.control_plane_enabled:
            return JSONResponse({"ok": False, "error": "control-plane disabled"}, status_code=404)

        safe_limit = max(1, min(limit, 200))
        try:
            decisions = _sort_recent(await app.state.runner.get_decisions())
            return {"ok": True, "count": len(decisions), "decisions": decisions[:safe_limit]}
        except Exception as e:
            return JSONResponse({"ok": False, "error": str(e)}, status_code=502)

    @app.get("/api/control-plane/runs")
    async def control_plane_runs(limit: int = 50):
        if not settings.control_plane_enabled:
            return JSONResponse({"ok": False, "error": "control-plane disabled"}, status_code=404)

        safe_limit = max(1, min(limit, 200))
        try:
            runs = _sort_recent(await app.state.runner.get_runs())
            return {"ok": True, "count": len(runs), "runs": runs[:safe_limit]}
        except Exception as e:
            return JSONResponse({"ok": False, "error": str(e)}, status_code=502)

    @app.get("/api/control-plane/summary")
    async def control_plane_summary():
        if not settings.control_plane_enabled:
            return JSONResponse({"ok": False, "error": "control-plane disabled"}, status_code=404)

        try:
            health, tasks, decisions, runs = await asyncio.gather(
                app.state.runner.get_health(),
                app.state.runner.get_tasks(),
                app.state.runner.get_decisions(),
                app.state.runner.get_runs(),
            )
            return _summary_payload(health=health, tasks=tasks, decisions=decisions, runs=runs)
        except Exception as e:
            return JSONResponse({"ok": False, "error": str(e)}, status_code=502)

    return app


app = create_app()

