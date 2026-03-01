import asyncio
import json
import os
import time
import uuid
from typing import Optional

from fastapi import FastAPI, Request, Response
from fastapi.responses import HTMLResponse, PlainTextResponse
from prometheus_client import CONTENT_TYPE_LATEST, Counter, Gauge, Histogram, generate_latest

APP_NAME = os.getenv("APP_NAME", "demo-app")
ENV = os.getenv("ENV", "prod")

app = FastAPI(title=APP_NAME)

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


INDEX_HTML = f"""<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>{APP_NAME}</title>
</head>
<body style="font-family: ui-sans-serif, system-ui; max-width: 860px; margin: 40px auto;">
  <h1>{APP_NAME}</h1>
  <p>Environment: <b>{ENV}</b></p>
  <ul>
    <li><a href="/healthz">/healthz</a></li>
    <li><a href="/metrics">/metrics</a></li>
    <li><a href="/slow?ms=500">/slow?ms=500</a> (latency demo)</li>
    <li><a href="/error?code=500">/error?code=500</a> (error demo)</li>
    <li><a href="/error?code=503">/error?code=503</a></li>
  </ul>
  <p>Use these endpoints to trigger Prometheus alerts and see logs in Loki.</p>
</body>
</html>
"""


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
async def index():
    return INDEX_HTML


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
