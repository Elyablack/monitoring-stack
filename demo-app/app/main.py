import asyncio
import json
import os
import time
import uuid
from pathlib import Path
from typing import Optional
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen

from fastapi import FastAPI, Request as FRequest, Response
from fastapi.responses import HTMLResponse, PlainTextResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from prometheus_client import CONTENT_TYPE_LATEST, Counter, Gauge, Histogram, generate_latest

APP_NAME = os.getenv("APP_NAME", "demo-app")
ENV = os.getenv("ENV", "prod")

BASE_DIR = Path(__file__).resolve().parent
TEMPLATES_DIR = BASE_DIR / "templates"
STATIC_DIR = BASE_DIR / "static"

RATE_LIMIT = int(os.getenv("RATE_LIMIT", "20"))
RATE_WINDOW = int(os.getenv("RATE_WINDOW", "60"))

LOKI_URL = os.getenv("LOKI_URL", "http://loki:3100").rstrip("/")
LOKI_TENANT = os.getenv("LOKI_TENANT", "").strip()
ALERTMANAGER_URL = os.getenv("ALERTMANAGER_URL", "http://alertmanager:9093").rstrip("/")

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

_rl_lock = asyncio.Lock()
_rl_hits: dict[str, list[float]] = {}


def _now_iso() -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())


def _path_label(request: FRequest) -> str:
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


def _client_ip(request: FRequest) -> str:
    xff = request.headers.get("x-forwarded-for", "")
    if xff:
        ip = xff.split(",")[0].strip()
        if ip:
            return ip
    if request.client and request.client.host:
        return request.client.host
    return "unknown"


async def _rate_limit(request: FRequest, bucket: str) -> Optional[Response]:
    ip = _client_ip(request)
    key = f"{bucket}:{ip}"

    now = time.time()
    cutoff = now - RATE_WINDOW

    async with _rl_lock:
        hits = _rl_hits.get(key, [])
        hits = [t for t in hits if t >= cutoff]

        if len(hits) >= RATE_LIMIT:
            retry_after = int(max(1, (hits[0] + RATE_WINDOW) - now))
            r = Response("too many requests\n", status_code=429, media_type="text/plain")
            r.headers["retry-after"] = str(retry_after)
            return r

        hits.append(now)
        _rl_hits[key] = hits

    return None


def _http_get_json(url: str, headers: dict[str, str] | None = None) -> dict:
    req = Request(url, headers=headers or {})
    try:
        with urlopen(req, timeout=8) as r:
            raw = r.read().decode("utf-8", errors="replace")
    except HTTPError as e:
        raw = e.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"http error {e.code}: {raw[:400]}") from e
    except URLError as e:
        raise RuntimeError(f"url error: {e}") from e

    try:
        return json.loads(raw)
    except json.JSONDecodeError as e:
        raise RuntimeError(f"json decode error: {raw[:400]}") from e


async def _http_get_json_async(url: str, headers: dict[str, str] | None = None) -> dict:
    return await asyncio.to_thread(_http_get_json, url, headers)


@app.middleware("http")
async def metrics_and_logs(request: FRequest, call_next):
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
            client_ip=_client_ip(request),
            user_agent=request.headers.get("user-agent"),
        )


@app.get("/", response_class=HTMLResponse)
async def index(request: FRequest):
    ctx = {
        "request": request,
        "app_name": APP_NAME,
        "env": ENV,
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
async def metrics():
    return Response(content=generate_latest(), media_type=CONTENT_TYPE_LATEST)


@app.get("/slow", response_class=PlainTextResponse)
async def slow(request: FRequest, ms: int = 250):
    deny = await _rate_limit(request, "danger")
    if deny is not None:
        return deny

    if ms < 0 or ms > 30_000:
        return Response("ms must be 0..30000\n", status_code=400, media_type="text/plain")

    APP_FORCED_LATENCY_TOTAL.labels(service=APP_NAME).inc()
    await asyncio.sleep(ms / 1000.0)

    _json_log("forced_slow", ms=ms, client_ip=_client_ip(request))
    return f"slept {ms}ms\n"


@app.get("/error")
async def error(request: FRequest, code: int = 500, msg: Optional[str] = None):
    deny = await _rate_limit(request, "danger")
    if deny is not None:
        return deny

    if code < 400 or code > 599:
        return Response("code must be 400..599\n", status_code=400, media_type="text/plain")

    APP_FORCED_ERRORS_TOTAL.labels(service=APP_NAME, code=str(code)).inc()

    body = (msg or f"forced error {code}") + "\n"
    _json_log("forced_error", code=code, msg=msg)
    return Response(body, status_code=code, media_type="text/plain")


@app.get("/_obs/alerts")
async def obs_alerts():
    url = f"{ALERTMANAGER_URL}/api/v2/alerts"
    try:
        data = await _http_get_json_async(url)
        out = []
        for a in data or []:
            labels = a.get("labels") or {}
            status = a.get("status")
            if isinstance(status, dict):
                status = status.get("state") or "unknown"
            out.append(
                {
                    "status": status or "unknown",
                    "startsAt": a.get("startsAt"),
                    "updatedAt": a.get("updatedAt"),
                    "alertname": labels.get("alertname"),
                    "severity": labels.get("severity"),
                    "instance": labels.get("instance"),
                    "instance_name": labels.get("instance_name"),
                    "job": labels.get("job"),
                    "summary": (a.get("annotations") or {}).get("summary"),
                }
            )
        out.sort(
            key=lambda x: (
                x.get("status") != "active",
                x.get("severity") or "",
                x.get("alertname") or "",
            )
        )
        return {"ok": True, "count": len(out), "alerts": out}
    except Exception as e:
        return {"ok": False, "error": str(e)}


def _loki_query_for_mode(mode: str) -> str:
    base = '{container="demo-app"}'
    if mode == "http_request":
        return base + ' |= "\\"event\\": \\"http_request\\""'
    if mode == "forced_error":
        return base + ' |= "\\"event\\": \\"forced_error\\""'
    if mode == "forced_slow":
        return base + ' |= "\\"event\\": \\"forced_slow\\""'
    return base + ' |~ "\\"event\\": \\"forced_(error|slow)\\""'


@app.get("/_obs/logs")
async def obs_logs(mode: str = "buttons", limit: int = 30):
    if limit < 1:
        limit = 1
    if limit > 200:
        limit = 200

    q = _loki_query_for_mode(mode)

    end_ns = int(time.time() * 1_000_000_000)
    start_ns = end_ns - 30 * 60 * 1_000_000_000

    qs = urlencode(
        {
            "query": q,
            "start": str(start_ns),
            "end": str(end_ns),
            "limit": str(limit),
            "direction": "backward",
        }
    )
    url = f"{LOKI_URL}/loki/api/v1/query_range?{qs}"

    headers: dict[str, str] = {}
    if LOKI_TENANT:
        headers["X-Scope-OrgID"] = LOKI_TENANT

    try:
        data = await _http_get_json_async(url, headers=headers)
        res = ((data.get("data") or {}).get("result") or [])
        lines: list[str] = []
        for stream in res:
            for ts, line in stream.get("values") or []:
                lines.append(line)
        lines = lines[-limit:]
        return {"ok": True, "mode": mode, "count": len(lines), "lines": lines}
    except Exception as e:
        return {"ok": False, "error": str(e)}
