from __future__ import annotations

import json
import time
from typing import Any, Dict


def now_iso_utc() -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())


def make_json_logger(service: str, env: str):
    def _log(event: str, **fields: Any) -> None:
        payload: Dict[str, Any] = {
            "ts": now_iso_utc(),
            "event": event,
            "service": service,
            "env": env,
            **fields,
        }
        print(json.dumps(payload, ensure_ascii=False), flush=True)

    return _log

