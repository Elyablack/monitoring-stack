import asyncio
import json
import os
import time
import uuid
from pathlib import Path
from typing import Optional

from fastapi import FastAPI, Request, Response
from fastapi.responses import HTMLResponse, PlainTextResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from prometheus_client import CONTENT_TYPE_LATEST, Counter, Gauge, Histogram, generate_latest

APP_NAME = os.getenv("APP_NAME", "demo-app")
ENV = os.getenv("ENV", "prod")

BASE_DIR = Path(__file__).resolve().parent
TEMPLATES_DIR = BASE_DIR / "templates"
STATIC_DIR = BASE_DIR / "static"

app = FastAPI(title=APP_NAME)

app.mount("/static", StaticFiles(directory=str(STATIC_DIR)), name="static")
templates = Jinja2Templates(directory=str(TEMPLATES_DIR))

HTTP_REQUESTS_TOTAL = Counter(
    "http_requests_total",
    "Total HTTP requests",
    ["service", "method", "path", "status"],
)
HTTP_REQUEST_DURATION = Histogram(
    "http_request_duration_seconds",
    "HTTP request latency in seconds",
    ["service", "method", "path"],
    buckets=(0.01, 0.025, 0.05, 0.1, 0.2, 0.35, 0.5, 0.75, 1, 2, 3, 5, 10),
)
HTTP_INFLIGHT = Gauge(
    "http_inflight_requests",
    "In-flight HTTP requests",
    ["service"],
)

APP_FORCED_ERRORS_TOTAL = Counter(
    "app_forced_errors_total",
    "Total forced errors returned by /error",
    ["service", "code"],
)
APP_FORCED_LATENCY_TOTAL = Counter(
    "app_forced_latency_total",
    "Total forced latency events triggered by /slow",
    ["service"],
)


def _now_iso() -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())


def _path_label(request: Request) -> str:
    return request.url.path


def _json_log(event: str, **fields) -> None:
    payload = {
        "ts": _now_iso(),
        "event": event,
        "service": APP_NAME,
        "env": ENV,
        **fields,
    }
    print(json.dumps(payload, ensure_ascii=False), flush=True)


@app.middleware("http")
async def metrics_and_logs(request: Request, call_next):
    req_id = request.headers.get("x-request-id") or str(uuid.uuid4())
    method = request.method
    path = _path_label(request)

    start = time.monotonic()
    HTTP_INFLIGHT.labels(service=APP_NAME).inc()

    status_code: int = 500
    try:
        response: Response = await call_next(request)
        status_code = response.status_code
        response.headers["x-request-id"] = req_id
        return response
    except Exception as e:
        _json_log(
            "unhandled_exception",
            request_id=req_id,
            method=method,
            path=path,
            error=str(e),
        )
        raise
    finally:
        dur = time.monotonic() - start
        HTTP_INFLIGHT.labels(service=APP_NAME).dec()

        HTTP_REQUESTS_TOTAL.labels(
            service=APP_NAME, method=method, path=path, status=str(status_code)
        ).inc()
        HTTP_REQUEST_DURATION.labels(service=APP_NAME, method=method, path=path).observe(dur)

        _json_log(
            "http_request",
            request_id=req_id,
            method=method,
            path=path,
            status=status_code,
            duration_ms=int(dur * 1000),
            client_ip=request.client.host if request.client else None,
            user_agent=request.headers.get("user-agent"),
        )


@app.get("/", response_class=HTMLResponse)
async def index(request: Request):
    ctx = {
        "request": request,
        "app_name": APP_NAME,
        "env": ENV,
        "endpoints": [
            {"name": "health", "method": "GET", "path": "/healthz", "descr": "healthcheck"},
            {"name": "metrics", "method": "GET", "path": "/metrics", "descr": "Prometheus scrape"},
            {"name": "slow", "method": "GET", "path": "/slow?ms=500", "descr": "latency demo"},
            {"name": "error", "method": "GET", "path": "/error?code=503", "descr": "error demo"},
        ],
    }
    return templates.TemplateResponse("index.html", ctx)


@app.get("/healthz", response_class=PlainTextResponse)
async def healthz():
    return "ok"


@app.get("/metrics")
async def metrics():
    return Response(content=generate_latest(), media_type=CONTENT_TYPE_LATEST)


@app.get("/slow", response_class=PlainTextResponse)
async def slow(ms: int = 250):
    if ms < 0 or ms > 30_000:
        return Response("ms must be 0..30000\n", status_code=400, media_type="text/plain")

    APP_FORCED_LATENCY_TOTAL.labels(service=APP_NAME).inc()
    await asyncio.sleep(ms / 1000.0)
    return f"slept {ms}ms\n"


@app.get("/error")
async def error(code: int = 500, msg: Optional[str] = None):
    if code < 400 or code > 599:
        return Response("code must be 400..599\n", status_code=400, media_type="text/plain")

    APP_FORCED_ERRORS_TOTAL.labels(service=APP_NAME, code=str(code)).inc()

    body = (msg or f"forced error {code}") + "\n"
    _json_log("forced_error", code=code, msg=msg)
    return Response(body, status_code=code, media_type="text/plain")
