from __future__ import annotations

import json
from datetime import datetime
from typing import Any, Dict, List, Tuple

SHOW_SOURCE_URL = False
SHOW_ALERTMANAGER_URL = False


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

    normalized_alerts = [a for a in alerts if isinstance(a, dict)]
    return data, normalized_alerts


def _as_dict(value: Any) -> Dict[str, Any]:
    return value if isinstance(value, dict) else {}


def _pick(*values: Any, default: str = "") -> str:
    for value in values:
        if value is None:
            continue
        text = str(value).strip()
        if text:
            return text
    return default


def _one_line(value: str) -> str:
    return " ".join(value.split()).strip()


def _fmt_ts(value: Any) -> str:
    raw = _pick(value)
    if not raw:
        return ""

    try:
        dt = datetime.fromisoformat(raw.replace("Z", "+00:00"))
        return dt.strftime("%Y-%m-%d %H:%M:%S UTC")
    except Exception:
        return raw


def _format_alert(alert: Dict[str, Any]) -> str:
    status = _pick(alert.get("status"), default="?").upper()

    labels = _as_dict(alert.get("labels"))
    annotations = _as_dict(alert.get("annotations"))

    alertname = _pick(labels.get("alertname"), default="unknown")
    severity = _pick(labels.get("severity"), default="n/a")
    job = _pick(labels.get("job"))
    service = _pick(labels.get("service"), labels.get("service_name"))
    instance = _pick(labels.get("instance"))
    instance_name = _pick(
        labels.get("instance_name"),
        labels.get("node"),
        labels.get("hostname"),
    )

    summary = _one_line(_pick(annotations.get("summary")))
    description = _one_line(_pick(annotations.get("description")))
    runbook = _pick(annotations.get("runbook_url"))
    generator = _pick(alert.get("generatorURL"))
    starts_at = _fmt_ts(alert.get("startsAt"))
    ends_at = _fmt_ts(alert.get("endsAt"))

    meta: List[str] = [f"sev={severity}"]
    if service:
        meta.append(f"service={service}")
    if job:
        meta.append(f"job={job}")
    if instance_name:
        meta.append(f"name={instance_name}")
    if instance:
        meta.append(f"instance={instance}")

    lines: List[str] = [
        f"[{status}] {alertname}",
        " ".join(meta),
    ]

    if summary:
        lines.append(f"summary: {summary}")
    if description and description != summary:
        lines.append(f"description: {description}")
    if starts_at:
        lines.append(f"startsAt: {starts_at}")
    if ends_at and status == "RESOLVED":
        lines.append(f"endsAt: {ends_at}")
    if runbook:
        lines.append(f"runbook: {runbook.split(':', 1)[-1].strip()}")
    if generator and SHOW_SOURCE_URL:
        lines.append(f"source: {generator}")

    return "\n".join(lines).strip()


def format_alerts_message(payload: Dict[str, Any], *, max_alerts: int) -> str:
    alerts = payload.get("alerts", []) or []
    if not isinstance(alerts, list):
        alerts = []

    alerts = [a for a in alerts if isinstance(a, dict)]

    if not alerts:
        return "Alertmanager webhook received (no alerts in payload)."

    status = _pick(payload.get("status"), default="unknown").upper()
    receiver = _pick(payload.get("receiver"))
    external_url = _pick(payload.get("externalURL"))

    group_labels = _as_dict(payload.get("groupLabels"))
    common_labels = _as_dict(payload.get("commonLabels"))
    common_annotations = _as_dict(payload.get("commonAnnotations"))

    lines: List[str] = [
        f"Alertmanager: {status} ({len(alerts)} alert{'s' if len(alerts) != 1 else ''})"
    ]

    header_meta: List[str] = []
    if receiver:
        header_meta.append(f"receiver={receiver}")

    group_alert = _pick(group_labels.get("alertname"))
    common_severity = _pick(common_labels.get("severity"))
    common_service = _pick(common_labels.get("service"), common_labels.get("service_name"))

    if group_alert:
        header_meta.append(f"group_alert={group_alert}")
    if common_severity:
        header_meta.append(f"severity={common_severity}")
    if common_service:
        header_meta.append(f"service={common_service}")

    if header_meta:
        lines.append(" ".join(header_meta))
    
    common_summary = _one_line(_pick(common_annotations.get("summary")))

    first_alert_summary = ""
    if len(alerts) == 1:
        first_annotations = _as_dict(alerts[0].get("annotations"))
        first_alert_summary = _one_line(_pick(first_annotations.get("summary")))

    if common_summary and not (len(alerts) == 1 and common_summary == first_alert_summary):
        lines.append(f"group_summary: {common_summary}")

    rendered = [_format_alert(alert) for alert in alerts[:max_alerts]]
    lines.append("\n\n---\n\n".join(rendered))

    remaining = len(alerts) - len(rendered)
    if remaining > 0:
        lines.append(f"... and {remaining} more alerts")

    if external_url and SHOW_ALERTMANAGER_URL:
        lines.append(f"alertmanager: {external_url}")

    return "\n\n".join(part for part in lines if part).strip()


def truncate_message(msg: str, max_len: int) -> str:
    if len(msg) <= max_len:
        return msg
    return msg[:max_len].rstrip() + "\n\n(truncated)"
