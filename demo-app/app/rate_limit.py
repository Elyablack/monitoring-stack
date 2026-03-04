from __future__ import annotations

import asyncio
import time
from collections import deque
from dataclasses import dataclass
from typing import Deque, Dict, Optional

from fastapi import Request, Response

from .metrics import client_ip


@dataclass(slots=True)
class RateLimitResult:
    allowed: bool
    retry_after_s: int = 0


class SlidingWindowRateLimiter:
    """In-memory sliding window limiter (demo-safe)."""

    def __init__(self, limit: int, window_s: int) -> None:
        self.limit = limit
        self.window_s = window_s
        self._lock = asyncio.Lock()
        self._hits: Dict[str, Deque[float]] = {}
        self._last_cleanup = 0.0

    async def check(self, request: Request, bucket: str) -> RateLimitResult:
        ip = client_ip(request)
        key = f"{bucket}:{ip}"

        now = time.time()
        cutoff = now - self.window_s

        async with self._lock:
            self._maybe_cleanup(now, cutoff)

            dq = self._hits.get(key)
            if dq is None:
                dq = deque()
                self._hits[key] = dq

            while dq and dq[0] < cutoff:
                dq.popleft()

            if len(dq) >= self.limit:
                retry_after = int(max(1, (dq[0] + self.window_s) - now))
                return RateLimitResult(allowed=False, retry_after_s=retry_after)

            dq.append(now)
            return RateLimitResult(allowed=True)

    def _maybe_cleanup(self, now: float, cutoff: float) -> None:
        if now - self._last_cleanup < 10:
            return
        self._last_cleanup = now

        dead = []
        for k, dq in self._hits.items():
            while dq and dq[0] < cutoff:
                dq.popleft()
            if not dq:
                dead.append(k)

        for k in dead:
            self._hits.pop(k, None)


def rate_limit_response(res: RateLimitResult) -> Optional[Response]:
    if res.allowed:
        return None
    r = Response("too many requests\n", status_code=429, media_type="text/plain")
    r.headers["retry-after"] = str(res.retry_after_s)
    return r

