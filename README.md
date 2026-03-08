# Observability Stack

![Validate Configs](https://github.com/Elyablack/monitoring-stack/actions/workflows/validate-configs.yml/badge.svg)

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

Production-style **observability and monitoring stack** built with **Prometheus, Loki and Grafana**.

This repository demonstrates a complete observability pipeline including:

- metrics collection
- log aggregation
- alerting
- dashboards
- Telegram alert notifications
- operational runbooks
- reverse proxy ingress
- basic SSH hardening

The stack runs entirely with **Docker Compose**.

---

# Live demo

A public demo instance of the application is available:

https://demo.142.93.143.228.nip.io/

The demo exposes endpoints used to trigger monitoring scenarios and alerts.

---

# Tech stack

- **Docker Compose** — service orchestration
- **Prometheus** — metrics collection and alert evaluation
- **Alertmanager** — alert routing and grouping
- **Loki** — log storage
- **Promtail** — log shipping
- **Grafana** — dashboards and visualization
- **Caddy** — reverse proxy and HTTPS ingress
- **Fail2ban** — SSH protection
- **Python / FastAPI** — demo application
- **Telegram** — alert notifications via `tg-relay`
- **Linux / Ubuntu** — deployment environment

---

# Architecture

Monitoring architecture including metrics, logs and alerting pipeline.

```
User → Caddy → demo-app

metrics pipeline
demo-app → Prometheus → Alertmanager → tg-relay → Telegram

logs pipeline
demo-app → Promtail → Loki → Grafana
```

Full architecture diagram: 

```
docs/architecture.png
```

---

# Dashboard preview

Example Grafana dashboard showing host metrics collected by node_exporter.

![Grafana Dashboard](docs/dashboard.png)

Metrics shown:
- CPU usage
- memory utilization
- network traffic
- disk usage

---

# Features

- Monitoring stack deployed with Docker Compose
- Prometheus alert rules for host and application health
- Loki + Promtail log pipeline
- Grafana dashboards for metrics and logs
- Telegram alert delivery through relay service
- Caddy reverse proxy for external access
- Fail2ban integration for SSH protection
- Demo endpoints for alert testing
- Runbook for incident investigation

---

# Quick start

Start the monitoring stack:

```
docker compose up -d
```

Verify containers:

```
docker ps
```

---

# Monitoring health check

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

# Operations

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

# Services

| Service | URL |
|--------|------|
| Grafana | http://localhost:3000 |
| Prometheus | http://localhost:9090 |
| Alertmanager | http://localhost:9093 |

If deployed with **Caddy**, Grafana may be exposed via HTTPS.

---

# Repository structure

```
.
├── docker-compose.yml
├── Makefile
├── .gitignore
├── .yamllint.yml
├── README.md
├── docs/
│   ├── runbook.md
│   └── dashboard.png
├── scripts/
│   └── monitor
├── prometheus/
│   ├── prometheus.yml
│   └── alerts.yml
├── alertmanager/
│   └── alertmanager.yml
├── loki/
│   └── loki.yml
├── promtail/
│   └── promtail.yml
├── grafana/
├── data/
├── loki-data/
├── alertmanager-data/
├── promtail-positions/
├── caddy/
├── fail2ban/
├── demo-app/
└── tg-relay/
```

---

# Alerts

Implemented alert rules include:

- NodeExporterDown
- HostLowDiskSpace
- HostMemoryPressure
- HostHighCpuLoad
- HostRebootDetected
- DemoAppDown
- DemoAppHigh5xxRate
- DemoAppHighP95Latency
- DemoAppHighInflight

Alert investigation steps are documented in:

```
docs/runbook.md
```

---

# Demo and testing

Trigger a **5xx error**:

```
https://demo.142.93.143.228.nip.io/error?code=503
```

Trigger a **slow request**:

```
https://demo.142.93.143.228.nip.io/slow
```

These endpoints allow testing the full monitoring pipeline:

1. trigger endpoint
2. observe metrics in Prometheus
3. verify alert firing
4. confirm Telegram notification

---

# Logs

Application logs are collected via **Promtail** and stored in **Loki**.

Logs can be explored in Grafana using LogQL queries.

Example:

```
{service_name="demo-app"} | json | status >= 500
```

---

# Security

Sensitive data is not tracked in the repository.

Ignored items include:

- runtime storage directories
- environment secrets
- TLS keys
- SSH keys

See `.gitignore` for details.

---

# Runbook

Operational troubleshooting documentation:

```
docs/runbook.md
```

---

# Skills demonstrated

- observability stack design
- Prometheus alerting rules
- centralized logging with Loki
- incident runbook design
- containerized infrastructure
- reverse proxy configuration
- CI validation for infrastructure configs

---

# CI/CD

The repository includes automated CI/CD pipelines implemented with **GitHub Actions**.

Two types of workflows are used:

### Infrastructure validation

Configuration changes are validated automatically before merging.

Checks include:

- YAML syntax validation
- Prometheus configuration validation
- Prometheus alert rules validation
- Alertmanager configuration validation
- Docker Compose configuration validation

Workflow:

https://github.com/Elyablack/monitoring-stack/blob/main/.github/workflows/validate-configs.yml

These checks prevent broken monitoring configurations from being merged.

---

### Application deployment

Application services are built and deployed automatically.

Pipeline stages:

1. Build Docker image
2. Push image to GitHub Container Registry (GHCR)
3. Deploy updated container on the VPS
4. Wait for container health checks
5. Automatic rollback on failure
6. Promote successful build to `stable` tag
7. Send deployment notification to Telegram

This deployment pipeline is used for:

- `demo-app`
- `tg-relay`

---

# Future improvements

### 1. Public dashboards
Expose selected Grafana dashboards publicly to demonstrate observability capabilities.

### 2. Infrastructure automation
Introduce Ansible for automated provisioning and configuration of the monitoring stack.

### 3. Distributed tracing
Extend observability with Grafana Tempo to correlate:
- metrics (Prometheus)
- logs (Loki)
- traces (Tempo)

### 4. Alert-driven automation
Introduce operational automation triggered by alerts:
- automated remediation scripts
- self-healing infrastructure
- alert-driven operational workflows

---

# License

MIT
