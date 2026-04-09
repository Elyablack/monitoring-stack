# Observability Stack

![Validate Configs](https://github.com/Elyablack/monitoring-stack/actions/workflows/validate-configs.yml/badge.svg)
![Dependabot](https://img.shields.io/badge/dependabot-enabled-025E8C?style=flat&logo=dependabot&logoColor=white)
![Renovate](https://img.shields.io/badge/renovate-enabled-1A1F6C?style=flat&logo=renovatebot&logoColor=white)


![Linux](https://img.shields.io/badge/-Linux-464646?style=flat&logo=linux&logoColor=56C0C0&color=008080)
![Docker Compose](https://img.shields.io/badge/-Docker_Compose-464646?style=flat&logo=docker&logoColor=56C0C0&color=008080)
![Prometheus](https://img.shields.io/badge/-Prometheus-464646?style=flat&logo=prometheus&logoColor=56C0C0&color=008080)
![Grafana](https://img.shields.io/badge/-Grafana-464646?style=flat&logo=grafana&logoColor=56C0C0&color=008080)
![Loki](https://img.shields.io/badge/-Loki-464646?style=flat&logo=grafana&logoColor=56C0C0&color=008080)
![Promtail](https://img.shields.io/badge/-Promtail-464646?style=flat&logo=grafana&logoColor=56C0C0&color=008080)
![Alertmanager](https://img.shields.io/badge/-Alertmanager-464646?style=flat&logo=prometheus&logoColor=56C0C0&color=008080)
![Caddy](https://img.shields.io/badge/-Caddy-464646?style=flat&logo=caddy&logoColor=56C0C0&color=008080)
![Fail2ban](https://img.shields.io/badge/-Fail2ban-464646?style=flat&logo=linux&logoColor=56C0C0&color=008080)
![Python](https://img.shields.io/badge/-Python-464646?style=flat&logo=python&logoColor=56C0C0&color=008080)
![FastAPI](https://img.shields.io/badge/-FastAPI-464646?style=flat&logo=fastapi&logoColor=56C0C0&color=008080)
![Telegram](https://img.shields.io/badge/-Telegram-464646?style=flat&logo=telegram&logoColor=56C0C0&color=008080)

Production-style observability platform built with Prometheus, Loki, Grafana, Alertmanager and FastAPI.

This repository demonstrates a full monitoring workflow:

- metrics collection
- log aggregation
- alert evaluation and routing
- public-safe dashboard and demo surfaces
- Telegram alert notifications
- runbooks for investigation and recovery
- reverse proxy ingress
- host and edge hardening
- CI validation and dependency automation

The stack runs with Docker Compose and includes a live demo application used to generate realistic monitoring and alert-validation scenarios.

---

## Live demo

Public demo instance:

- `https://demo.142.93.143.228.nip.io/`

Primary demo surfaces:

- `/` — demo app with traffic generation, scenario controls, alert preview, and log preview
- `/control-plane` — read-only control-plane activity view for alert-driven workflows
- `/dashboards` — curated public-safe dashboard preview gallery

The demo is designed to show how telemetry flows from application traffic into metrics, logs, alerts and operational investigation surfaces.

---

## What this project shows

This project is meant to be more than a local monitoring lab.

It demonstrates how to package observability as a usable operational surface:

- generate traffic and errors on demand
- watch logs and alerts update in near real time
- view public-safe dashboard previews
- follow alert investigation paths with runbooks
- connect observability with a separate alert-driven control-plane

---

## Tech stack

- **Docker Compose** — service orchestration
- **Prometheus** — metrics collection and alert evaluation
- **Alertmanager** — alert routing and grouping
- **Loki** — log storage
- **Promtail** — log shipping
- **Grafana** — dashboards and visualization
- **Caddy** — reverse proxy and HTTPS ingress
- **Fail2ban** — SSH and HTTP abuse protection
- **Python / FastAPI** — demo application and public surfaces
- **Telegram** — alert notifications via `tg-relay`
- **Linux / Ubuntu** — deployment environment

---

## Public demo surfaces

### 1. Demo app

The main demo surface provides:

- manual traffic generation
- fast demo alert scenarios
- 5xx and latency scenarios
- Alertmanager preview
- Loki button-log preview
- alert-friendly validation flows

This page is used to validate that telemetry, alerts and UI feedback stay aligned.

### 2. Control-plane view

A read-only control-plane page exposes:

- recent decisions
- queued tasks
- action runs
- pipeline summary
- orchestration visibility for alert-driven workflows

This is useful when the monitoring stack is connected to the separate `control-plane` repository.

### 3. Dashboard gallery

The dashboard gallery is a public-safe preview page containing curated dashboard screenshots for:

- control-plane overview
- demo app observability
- mac agent state
- application alerts
- host alerts

This keeps the public demo useful even when Grafana itself is not directly exposed.

---

## Architecture

Monitoring architecture including metrics, logs and alert flow:

```
User -> Caddy -> demo-app

metrics pipeline
demo-app -> Prometheus -> Alertmanager -> tg-relay -> Telegram

logs pipeline
demo-app -> Promtail -> Loki -> Grafana
```

When connected to the separate control-plane:

```
Alertmanager -> control-plane -> decision -> task -> run -> remediation / notification
```

Architecture diagram:

- [`docs/architecture.png`](docs/architecture.png)

---

## Dashboards and investigation surfaces

The stack includes multiple investigation entry points:

- live demo app for traffic generation
- dashboard preview gallery for public-safe screenshots
- Grafana dashboards for full internal exploration
- runbooks for operator workflow

Typical dashboard coverage includes:
	
- host health
- application health
- backup status
- latency and saturation
- alert-oriented views
- control-plane and remediation activity

---

## Features

- Monitoring stack deployed with Docker Compose
- Prometheus alert rules for host and application health
- Loki + Promtail log pipeline
- Grafana dashboards for metrics and logs
- Telegram alert delivery through relay service
- Caddy reverse proxy for external access
- Fail2ban integration for SSH and HTTP abuse patterns
- Demo endpoints for alert testing
- Public-safe dashboard gallery
- Runbook for incident investigation
- Optional integration with alert-driven control-plane workflows

---

## Related repositories

### control-plane

Alert-driven orchestration engine that consumes selected alerts and turns them into:

- decisions
- queued tasks
- action runs
- chained workflows
- remediation outcomes

Repository:

- [Elyablack/control-plane](https://github.com/Elyablack/control-plane)

### infra

Supporting infrastructure automation repository used for bootstrap, backup, restore and recovery workflows.

Repository:

- [Elyablack/infra](https://github.com/Elyablack/infra)

This separation keeps the observability layer, orchestration layer and infrastructure automation layer independent.

---

## Quick start

Start the monitoring stack:

```
docker compose up -d
docker ps
```

---

## Monitoring health check

A helper script is available to verify the monitoring stack.

Run:

```
monitor
```

Checks performed:

- running Docker containers
- Prometheus readiness
- Alertmanager readiness
- Loki readiness
- demo-app health endpoint
- tg-relay container health
- Prometheus scrape targets status
- unhealthy scrape targets
- currently firing alerts
- pending alerts

Location:

```
scripts/monitoring-health.sh
```

---

## Runbooks

Investigation procedures are documented in:

- [`docs/runbook.md`](docs/runbook.md)
- [`docs/runbooks/host-alerts.md`](docs/runbooks/host-alerts.md)
- [`docs/runbooks/application-alerts.md`](docs/runbooks/application-alerts.md)
- [`docs/runbooks/backup-alerts.md`](docs/runbooks/backup-alerts.md)
- [`docs/runbooks/demo-alerts.md`](docs/runbooks/demo-alerts.md)

---

## Operations

### Check container status

```
docker compose ps
```

### Inspect logs

```
docker compose logs --tail=100
```

### Check Prometheus alerts

```
curl http://127.0.0.1:9090/api/v1/alerts | jq
```

### Check Prometheus targets

```
curl http://127.0.0.1:9090/api/v1/targets | jq
```

### Check Loki health

```
curl http://127.0.0.1:3100/ready
```

### Check Alertmanager health

```
curl http://127.0.0.1:9093/-/ready
```

---

## Services

| Service | URL |
|--------|------|
| Demo app | https://demo.142.93.143.228.nip.io |
| Grafana | http://localhost:3000 |
| Prometheus | http://localhost:9090 |
| Alertmanager | http://localhost:9093 |

If deployed with **Caddy**, Grafana and demo surfaces may also be exposed via HTTPS.

---

## Repository structure

```
.
├── docker-compose.yml
├── Makefile
├── renovate.json
├── README.md
├── docs/
│   ├── runbook.md
│   ├── architecture.png
│   ├── images/
│   └── runbooks/
├── scripts/
│   └── monitoring-health.sh
├── prometheus/
│   ├── prometheus.yml
│   └── alerts.yml
├── alertmanager/
│   └── alertmanager.yml
├── loki/
│   └── loki.yml
├── promtail/
│   └── promtail.yml
├── caddy/
├── fail2ban/
├── demo-app/
├── tg-relay/
└── grafana/
```

---

## Alerts

Implemented alert rules include:

- NodeExporterDown
- HostLowDiskSpace
- HostMemoryPressure
- HostHighCpuLoad
- HostRebootDetected
- BackupMissing
- DemoAppDown
- DemoAppHigh5xxRate
- DemoAppHighP95Latency
- DemoAppHighInflight
- DemoAppButtonError503
- DemoAppButtonSlow

Alert investigation steps are documented in:

- [`docs/runbook.md`](docs/runbook.md)

---

## Demo scenarios

The demo app supports manual validation scenarios such as:

- single 503 error generation
- single slow request generation
- burst 5xx demo scenarios
- burst latency demo scenarios
- combined traffic scenarios
- alert visibility checks
- control-plane validation flows

These scenarios are useful for:

- alert testing
- dashboard validation
- incident walkthroughs
- public demo validation
- portfolio demonstrations

---
   
## Logs

Application logs are collected via **Promtail** and stored in **Loki**.

The demo surface also exposes a public-safe log preview for button-generated scenarios.

Example LogQL:

```
{service_name="demo-app"} | json | status >= 500
```

---

## Security

### Pinned images (reproducible deployments)

Core infrastructure images are pinned by digest in docker-compose.yml to avoid unexpected changes from floating tags like latest.

### Container hardening

Services use container hardening defaults where applicable:

- no-new-privileges    
- cap_drop: ALL
- PID limits

### Secrets hygiene

Sensitive data is not tracked in the repository.

Ignored items include:

- runtime storage directories    
- environment secrets
- TLS keys
- SSH keys

See .gitignore for details.

---

## CI/CD

The repository uses GitHub Actions for CI and deployments.

### Infrastructure validation

Configuration changes are validated automatically before merging.

- YAML lint
- Prometheus config validation (promtool)
- Prometheus rules validation (promtool)
- Alertmanager config validation (amtool)

Workflow:
```
https://github.com/Elyablack/monitoring-stack/blob/main/.github/workflows/validate-configs.yml
```

### Application build & deploy

Application services are built and deployed automatically:

- demo-app    
- tg-relay

Flow:

1. Build image    
2. Push image to GHCR
3. Deploy updated container on VPS (SHA tag)
4. Health wait
5. Automatic rollback to stable on failure
6. Telegram deployment notification

### Release tags

Creating a tag vX.Y.Z publishes:

- ghcr.io/elyablack/demo-app:X.Y.Z    
- ghcr.io/elyablack/demo-app:stable
- ghcr.io/elyablack/demo-app:latest

(and same for tg-relay)

---

## Dependency automation

- **Dependabot** updates **GitHub Actions** weekly.
- **Renovate** updates **Docker images** (compose/Dockerfiles) weekly, with auto-merge for patch/digest updates.

---
  
## Future directions

### Agentic operations

Extend the stack from observability toward operability by introducing agent-driven operational workflows.

Planned capabilities include:

- alert-driven diagnostics
- automated collection of logs and metrics context
- remediation suggestions
- approval-based operational actions
- incident summaries delivered to Telegram

### Tool-using assistants

Add support for agents capable of interacting with operational tools such as:

- shell
- Docker
- systemd
- Kubernetes
- GitHub
- messaging APIs

### Message and incident analysis

Introduce bots for structured analysis of Telegram or chat-based operational messages, including:

- summarization
- incident extraction
- daily digests
- task detection
- signal-to-noise reduction

### Distributed tracing

Extend the stack with Grafana Tempo to correlate:

- metrics
- logs
- traces

This will provide richer context for future agent-based diagnostics.

---

## License

MIT
