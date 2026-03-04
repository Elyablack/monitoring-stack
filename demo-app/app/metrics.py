from __future__ import annotations

import time
import uuid
from typing import Callable

from fastapi import Request, Response
from prometheus_client import CONTENT_TYPE_LATEST, Counter, Gauge, Histogram, generate_latest


class Metrics:
    """Prometheus metrics for the service."""

    def __init__(self, service: str) -> None:
        self.service = service

        self.http_requests_total = Counter(
            "http_requests_total",
            "Total HTTP requests",
            ["service", "method", "path", "status"],
        )
        self.http_request_duration = Histogram(
            "http_request_duration_seconds",
            "HTTP request latency in seconds",
            ["service", "method", "path"],
            buckets=(0.01, 0.025, 0.05, 0.1, 0.2, 0.35, 0.5, 0.75, 1, 2, 3, 5, 10),
        )
        self.http_inflight = Gauge(
            "http_inflight_requests",
            "In-flight HTTP requests",
            ["service"],
        )

        self.app_forced_errors_total = Counter(
            "app_forced_errors_total",
            "Total forced errors returned by /error",
            ["service", "code"],
        )
        self.app_forced_latency_total = Counter(
            "app_forced_latency_total",
            "Total forced latency events triggered by /slow",
            ["service"],
        )

    def metrics_response(self) -> Response:
        return Response(content=generate_latest(), media_type=CONTENT_TYPE_LATEST)


def client_ip(request: Request) -> str:
    xff = request.headers.get("x-forwarded-for", "")
    if xff:
        ip = xff.split(",")[0].strip()
        if ip:
            return ip
    if request.client and request.client.host:
        return request.client.host
    return "unknown"


def route_template_path(request: Request) -> str:
    route = request.scope.get("route")
    p = getattr(route, "path", None)
    if isinstance(p, str) and p:
        return p
    return request.url.path


def ensure_request_id(request: Request) -> str:
    rid = request.headers.get("x-request-id")
    return rid.strip() if rid else str(uuid.uuid4())


def metrics_middleware(metrics: Metrics, json_log: Callable[..., None]):
    async def _mw(request: Request, call_next):
        req_id = ensure_request_id(request)
        method = request.method
        path = route_template_path(request)

        start = time.monotonic()
        metrics.http_inflight.labels(service=metrics.service).inc()

        status_code = 500
        try:
            response: Response = await call_next(request)
            status_code = response.status_code
            response.headers["x-request-id"] = req_id
            return response
        except Exception as e:
            json_log(
                "unhandled_exception",
                request_id=req_id,
                method=method,
                path=path,
                error=str(e),
            )
            raise
        finally:
            dur = time.monotonic() - start
            metrics.http_inflight.labels(service=metrics.service).dec()

            metrics.http_requests_total.labels(
                service=metrics.service,
                method=method,
                path=path,
                status=str(status_code),
            ).inc()
            metrics.http_request_duration.labels(
                service=metrics.service,
                method=method,
                path=path,
            ).observe(dur)

            json_log(
                "http_request",
                request_id=req_id,
                method=method,
                path=path,
                status=status_code,
                duration_ms=int(dur * 1000),
                client_ip=client_ip(request),
                user_agent=request.headers.get("user-agent"),
            )

    return _mw
