from __future__ import annotations

import json
from typing import Any, Dict, List, Tuple


def parse_payload(raw: bytes) -> Tuple[Dict[str, Any], List[Dict[str, Any]]]:
    try:
        data = json.loads(raw.decode("utf-8"))
        if not isinstance(data, dict):
            data = {}
    except Exception:
        data = {}

    alerts = data.get("alerts", []) or []
    if not isinstance(alerts, list):
        alerts = []
    return data, [a for a in alerts if isinstance(a, dict)]


def format_alerts_message(alerts: List[Dict[str, Any]], *, max_alerts: int) -> str:
    if not alerts:
        return "Alertmanager: webhook received (no alerts in payload)."

    lines: List[str] = []
    for a in alerts[:max_alerts]:
        status = a.get("status", "?")
        labels = a.get("labels", {}) or {}
        ann = a.get("annotations", {}) or {}

        if not isinstance(labels, dict):
            labels = {}
        if not isinstance(ann, dict):
            ann = {}

        name = labels.get("alertname", "unknown")
        sev = labels.get("severity", "n/a")
        job = labels.get("job", "")
        inst = labels.get("instance", "n/a")

        inst_name = (
            labels.get("instance_name", "")
            or labels.get("node", "")
            or labels.get("hostname", "")
        )

        summary = (ann.get("summary") or "").strip()
        descr = (ann.get("description") or "").strip()

        header = f"[{status}] {name} sev={sev}"
        if job:
            header += f" job={job}"
        header += f" instance={inst}"
        if inst_name:
            header += f" name={inst_name}"

        block = header
        if summary:
            block += "\n" + summary
        if descr and descr != summary:
            block += "\n" + descr

        lines.append(block.strip())

    return "\n\n---\n\n".join(lines)


def truncate_message(msg: str, max_len: int) -> str:
    if len(msg) <= max_len:
        return msg
    return msg[:max_len] + "\n\n(truncated)"
