#!/usr/bin/env bash
set -euo pipefail

FAILED=0
WARNINGS=0

RED="\033[31m"
YELLOW="\033[33m"
GREEN="\033[32m"
BLUE="\033[36m"
RESET="\033[0m"

say() {
  printf "\n${BLUE}=== %s ===${RESET}\n" "$1"
}

ok() {
  printf "${GREEN}OK${RESET}: %s\n" "$1"
}

warn() {
  printf "${YELLOW}WARN${RESET}: %s\n" "$1"
  WARNINGS=$((WARNINGS + 1))
}

fail() {
  printf "${RED}FAIL${RESET}: %s\n" "$1"
  FAILED=$((FAILED + 1))
}

say "containers"
docker ps --format 'table {{.Names}}\t{{.Status}}'

say "prometheus ready"
if curl -fsS http://127.0.0.1:9090/-/ready >/dev/null; then
  ok "prometheus ready"
else
  fail "prometheus not ready"
fi

say "alertmanager ready"
if curl -fsS http://127.0.0.1:9093/-/ready >/dev/null; then
  ok "alertmanager ready"
else
  fail "alertmanager not ready"
fi

say "loki ready"
if curl -fsS http://127.0.0.1:3100/ready >/dev/null; then
  ok "loki ready"
else
  fail "loki not ready"
fi

say "demo-app health"
if curl -fsk https://demo.142.93.143.228.nip.io/healthz >/dev/null; then
  ok "demo-app healthy"
else
  fail "demo-app healthz failed"
fi

say "tg-relay health"
tg_health="$(docker inspect tg-relay --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' 2>/dev/null || true)"
if [ "${tg_health:-unknown}" = "healthy" ] || [ "${tg_health:-unknown}" = "running" ]; then
  ok "tg-relay ${tg_health}"
else
  fail "tg-relay ${tg_health:-unknown}"
fi

say "prometheus targets"
curl -fsS http://127.0.0.1:9090/api/v1/targets \
| jq -r '.data.activeTargets[] | "\(.labels.node) \(.labels.instance) -> \(.health)"'

say "unhealthy targets"
unhealthy_targets="$(
  curl -fsS http://127.0.0.1:9090/api/v1/targets \
  | jq -r '.data.activeTargets[] | select(.health != "up") | "\(.labels.node) \(.labels.instance) -> \(.health)"'
)"
if [ -n "${unhealthy_targets}" ]; then
  printf '%s\n' "${unhealthy_targets}"
  warn "there are unhealthy targets"
else
  ok "all active targets are up"
fi

say "alerts firing"
firing_alerts="$(
  curl -fsS http://127.0.0.1:9090/api/v1/alerts \
  | jq -r '.data.alerts[] | select(.state=="firing") | "\(.labels.alertname) instance=\(.labels.instance // "-") severity=\(.labels.severity // "-")"'
)"
if [ -n "${firing_alerts}" ]; then
  printf '%s\n' "${firing_alerts}"
  warn "there are firing alerts"
else
  ok "no firing alerts"
fi

say "alerts pending"
pending_alerts="$(
  curl -fsS http://127.0.0.1:9090/api/v1/alerts \
  | jq -r '.data.alerts[] | select(.state=="pending") | "\(.labels.alertname) instance=\(.labels.instance // "-") severity=\(.labels.severity // "-")"'
)"
if [ -n "${pending_alerts}" ]; then
  printf '%s\n' "${pending_alerts}"
  warn "there are pending alerts"
else
  ok "no pending alerts"
fi

say "summary"
if [ "$FAILED" -gt 0 ]; then
  printf "${RED}RESULT: FAIL (%s errors, %s warnings)${RESET}\n" "$FAILED" "$WARNINGS"
  exit 1
fi

if [ "$WARNINGS" -gt 0 ]; then
  printf "${YELLOW}RESULT: WARN (%s warnings)${RESET}\n" "$WARNINGS"
  exit 0
fi

printf "${GREEN}RESULT: OK${RESET}\n"
exit 0
