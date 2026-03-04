from __future__ import annotations

from dataclasses import dataclass
from typing import Dict, List, Optional

import httpx


@dataclass(frozen=True, slots=True)
class AlertView:
    status: str
    startsAt: Optional[str]
    updatedAt: Optional[str]
    alertname: Optional[str]
    severity: Optional[str]
    instance: Optional[str]
    instance_name: Optional[str]
    job: Optional[str]
    summary: Optional[str]


class AlertmanagerClient:
    def __init__(self, http: httpx.AsyncClient, base_url: str) -> None:
        self.http = http
        self.base_url = base_url.rstrip("/")

    async def get_alerts(self) -> List[AlertView]:
        r = await self.http.get(f"{self.base_url}/api/v2/alerts")
        r.raise_for_status()
        data = r.json() or []

        out: List[AlertView] = []
        for a in data:
            labels = (a.get("labels") or {}) if isinstance(a, dict) else {}
            status = a.get("status") if isinstance(a, dict) else None
            if isinstance(status, dict):
                status = status.get("state") or "unknown"
            annotations = (a.get("annotations") or {}) if isinstance(a, dict) else {}

            out.append(
                AlertView(
                    status=str(status or "unknown"),
                    startsAt=a.get("startsAt"),
                    updatedAt=a.get("updatedAt"),
                    alertname=labels.get("alertname"),
                    severity=labels.get("severity"),
                    instance=labels.get("instance"),
                    instance_name=labels.get("instance_name"),
                    job=labels.get("job"),
                    summary=annotations.get("summary"),
                )
            )

        out.sort(key=lambda x: (x.status != "active", x.severity or "", x.alertname or ""))
        return out


class LokiClient:
    def __init__(self, http: httpx.AsyncClient, base_url: str, tenant: str = "") -> None:
        self.http = http
        self.base_url = base_url.rstrip("/")
        self.tenant = tenant.strip()

    async def query_range(
        self,
        *,
        query: str,
        start_ns: int,
        end_ns: int,
        limit: int,
        direction: str = "backward",
    ) -> List[str]:
        headers: Dict[str, str] = {}
        if self.tenant:
            headers["X-Scope-OrgID"] = self.tenant

        r = await self.http.get(
            f"{self.base_url}/loki/api/v1/query_range",
            params={
                "query": query,
                "start": str(start_ns),
                "end": str(end_ns),
                "limit": str(limit),
                "direction": direction,
            },
            headers=headers,
        )
        r.raise_for_status()
        payload = r.json()

        res = ((payload.get("data") or {}).get("result") or [])
        lines: List[str] = []
        for stream in res:
            for _ts, line in (stream.get("values") or []):
                lines.append(line)
        return lines
