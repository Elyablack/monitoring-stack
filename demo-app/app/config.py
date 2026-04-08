from __future__ import annotations

import os
from dataclasses import dataclass


def _env_int(name: str, default: int, *, min_v: int | None = None, max_v: int | None = None) -> int:
    raw = os.getenv(name, str(default)).strip()
    try:
        v = int(raw)
    except ValueError as e:
        raise RuntimeError(f"{name} must be int, got {raw!r}") from e
    if min_v is not None and v < min_v:
        raise RuntimeError(f"{name} must be >= {min_v}, got {v}")
    if max_v is not None and v > max_v:
        raise RuntimeError(f"{name} must be <= {max_v}, got {v}")
    return v


def _env_str(name: str, default: str) -> str:
    return os.getenv(name, default).strip()


def _env_float(name: str, default: float, *, min_v: float | None = None, max_v: float | None = None) -> float:
    raw = os.getenv(name, str(default)).strip()
    try:
        v = float(raw)
    except ValueError as e:
        raise RuntimeError(f"{name} must be float, got {raw!r}") from e
    if min_v is not None and v < min_v:
        raise RuntimeError(f"{name} must be >= {min_v}, got {v}")
    if max_v is not None and v > max_v:
        raise RuntimeError(f"{name} must be <= {max_v}, got {v}")
    return v


def _env_bool(name: str, default: bool) -> bool:
    raw = os.getenv(name, "true" if default else "false").strip().lower()
    if raw in {"1", "true", "yes", "y", "on"}:
        return True
    if raw in {"0", "false", "no", "n", "off"}:
        return False
    raise RuntimeError(f"{name} must be boolean-like, got {raw!r}")


def _split_csv(raw: str) -> list[str]:
    raw = (raw or "").strip()
    if not raw:
        return []
    return [x.strip() for x in raw.split(",") if x.strip()]


@dataclass(frozen=True, slots=True)
class Settings:
    """
    Runtime settings sourced from env.
    """

    app_name: str
    env: str
    app_version: str

    rate_limit: int
    rate_window_s: int

    loki_url: str
    loki_tenant: str
    loki_stream_selector: str
    loki_query_window_s: int

    alertmanager_url: str
    http_timeout_s: float

    ready_urls: list[str]

    control_plane_enabled: bool
    action_runner_url: str

    grafana_public_url: str

    @staticmethod
    def load() -> "Settings":
        app_name = _env_str("APP_NAME", "demo-app")
        env = _env_str("ENV", "prod")
        app_version = _env_str("APP_VERSION", "") or _env_str("GIT_SHA", "") or "dev"

        rate_limit = _env_int("RATE_LIMIT", 20, min_v=1, max_v=10_000)
        rate_window_s = _env_int("RATE_WINDOW", 60, min_v=1, max_v=3600)

        loki_url = _env_str("LOKI_URL", "http://loki:3100").rstrip("/")
        loki_tenant = _env_str("LOKI_TENANT", "")
        loki_stream_selector = _env_str("LOKI_STREAM_SELECTOR", '{container="demo-app"}')
        loki_query_window_s = _env_int("LOKI_QUERY_WINDOW_S", 30 * 60, min_v=10, max_v=24 * 3600)

        alertmanager_url = _env_str("ALERTMANAGER_URL", "http://alertmanager:9093").rstrip("/")
        http_timeout_s = _env_float("HTTP_TIMEOUT_S", 8.0, min_v=0.2, max_v=60.0)

        ready_urls = _split_csv(_env_str("READY_URLS", ""))

        control_plane_enabled = _env_bool("CONTROL_PLANE_ENABLED", True)
        action_runner_url = _env_str("ACTION_RUNNER_URL", "http://172.19.0.1:8088").rstrip("/")

        grafana_public_url = _env_str(
            "GRAFANA_PUBLIC_URL",
            "https://grafana.142.93.143.228.nip.io",
        ).rstrip("/")

        return Settings(
            app_name=app_name,
            env=env,
            app_version=app_version,
            rate_limit=rate_limit,
            rate_window_s=rate_window_s,
            loki_url=loki_url,
            loki_tenant=loki_tenant,
            loki_stream_selector=loki_stream_selector,
            loki_query_window_s=loki_query_window_s,
            alertmanager_url=alertmanager_url,
            http_timeout_s=http_timeout_s,
            ready_urls=ready_urls,
            control_plane_enabled=control_plane_enabled,
            action_runner_url=action_runner_url,
            grafana_public_url=grafana_public_url,
        )
