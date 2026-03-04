from __future__ import annotations

import os
from dataclasses import dataclass


def _env_str(name: str, default: str = "") -> str:
    return os.environ.get(name, default).strip()


def _env_int(name: str, default: int, *, min_v: int | None = None, max_v: int | None = None) -> int:
    raw = _env_str(name, str(default))
    try:
        v = int(raw)
    except ValueError as e:
        raise RuntimeError(f"{name} must be int, got {raw!r}") from e
    if min_v is not None and v < min_v:
        v = min_v
    if max_v is not None and v > max_v:
        v = max_v
    return v


def _env_bool(name: str, default: bool = False) -> bool:
    raw = _env_str(name, "1" if default else "0").lower()
    return raw in ("1", "true", "yes", "y", "on")


@dataclass(frozen=True, slots=True)
class Settings:
    tg_bot_token: str
    tg_chat_id: str

    max_msg: int
    max_alerts: int
    max_payload_bytes: int

    port: int
    dry_run: bool

    version: str

    @staticmethod
    def load() -> "Settings":
        return Settings(
            tg_bot_token=_env_str("TG_BOT_TOKEN"),
            tg_chat_id=_env_str("TG_CHAT_ID"),
            max_msg=_env_int("MAX_MSG", 3500, min_v=200, max_v=20_000),
            max_alerts=_env_int("MAX_ALERTS", 50, min_v=1, max_v=200),
            max_payload_bytes=_env_int("MAX_PAYLOAD_BYTES", 256_000, min_v=1_000, max_v=5_000_000),
            port=_env_int("PORT", 8080, min_v=1, max_v=65535),
            dry_run=_env_bool("DRY_RUN", False),
            version=_env_str("APP_VERSION", _env_str("GIT_SHA", "dev")),
        )
