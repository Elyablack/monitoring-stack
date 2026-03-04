from __future__ import annotations

import asyncio
from dataclasses import asdict
from pathlib import Path
from typing import Optional

import httpx
from fastapi import FastAPI, Request, Response
from fastapi.responses import HTMLResponse, PlainTextResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates

from .clients import AlertmanagerClient, LokiClient
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

    @app.on_event("startup")
    async def _startup() -> None:
        app.state.http = httpx.AsyncClient(timeout=httpx.Timeout(settings.http_timeout_s))
        app.state.alerts = AlertmanagerClient(app.state.http, settings.alertmanager_url)
        app.state.loki = LokiClient(app.state.http, settings.loki_url, tenant=settings.loki_tenant)

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
                {"name": "metrics", "method": "GET", "path": "/metrics", "descr": "Prometheus scrape"},
                {"name": "slow", "method": "GET", "path": "/slow?ms=500", "descr": "latency demo"},
                {"name": "error", "method": "GET", "path": "/error?code=503", "descr": "error demo"},
                {"name": "obs_alerts", "method": "GET", "path": "/_obs/alerts", "descr": "Alertmanager API (read)"},
                {"name": "obs_logs", "method": "GET", "path": "/_obs/logs?mode=buttons&limit=20", "descr": "Loki logs (filtered)"},
            ],
        }
        return templates.TemplateResponse("index.html", ctx)

    @app.get("/healthz", response_class=PlainTextResponse)
    async def healthz():
        return "ok"

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

    return app


app = create_app()
