from __future__ import annotations

import json
import time
from dataclasses import dataclass
from typing import Any, Dict, List, Optional, Tuple

from .clients import LokiClient
from .config import Settings


def loki_query_for_mode(settings: Settings, mode: str) -> str:
    base = settings.loki_stream_selector
    if mode == "http_request":
        return base + ' |= "\\"event\\": \\"http_request\\""'
    if mode == "forced_error":
        return base + ' |= "\\"event\\": \\"forced_error\\""'
    if mode == "forced_slow":
        return base + ' |= "\\"event\\": \\"forced_slow\\""'
    return base + ' |~ "\\"event\\": \\"forced_(error|slow)\\""'


@dataclass(slots=True)
class LogEntry:
    ts: Optional[str]
    event: Optional[str]
    service: Optional[str]
    env: Optional[str]
    method: Optional[str]
    path: Optional[str]
    status: Optional[int]
    duration_ms: Optional[int]
    client_ip: Optional[str]
    msg: Optional[str]
    code: Optional[int]
    ms: Optional[int]
    raw: str


def parse_json_log_line(line: str) -> LogEntry:
    raw = line
    try:
        o = json.loads(line)
        if not isinstance(o, dict):
            raise ValueError("not object")
    except Exception:
        return LogEntry(
            ts=None,
            event=None,
            service=None,
            env=None,
            method=None,
            path=None,
            status=None,
            duration_ms=None,
            client_ip=None,
            msg=None,
            code=None,
            ms=None,
            raw=raw,
        )

    def _s(k: str) -> Optional[str]:
        v = o.get(k)
        return v if isinstance(v, str) and v else None

    def _i(k: str) -> Optional[int]:
        v = o.get(k)
        if isinstance(v, bool):
            return None
        if isinstance(v, int):
            return v
        if isinstance(v, str):
            try:
                return int(v)
            except ValueError:
                return None
        return None

    return LogEntry(
        ts=_s("ts"),
        event=_s("event"),
        service=_s("service"),
        env=_s("env"),
        method=_s("method"),
        path=_s("path"),
        status=_i("status"),
        duration_ms=_i("duration_ms"),
        client_ip=_s("client_ip"),
        msg=_s("msg"),
        code=_i("code"),
        ms=_i("ms"),
        raw=raw,
    )


def summarize_entries(entries: List[LogEntry]) -> Dict[str, Any]:
    by_event: Dict[str, int] = {}
    by_status: Dict[str, int] = {}
    for e in entries:
        ev = e.event or "unknown"
        by_event[ev] = by_event.get(ev, 0) + 1
        if e.status is not None:
            s = str(e.status)
            by_status[s] = by_status.get(s, 0) + 1
    return {"by_event": by_event, "by_status": by_status}


async def fetch_logs(settings: Settings, loki: LokiClient, *, mode: str, limit: int) -> Tuple[List[LogEntry], str]:
    limit = max(1, min(limit, 200))
    q = loki_query_for_mode(settings, mode)

    end_ns = int(time.time() * 1_000_000_000)
    start_ns = end_ns - settings.loki_query_window_s * 1_000_000_000

    lines = await loki.query_range(query=q, start_ns=start_ns, end_ns=end_ns, limit=limit)
    lines = lines[-limit:]
    entries = [parse_json_log_line(x) for x in lines]
    return entries, q

