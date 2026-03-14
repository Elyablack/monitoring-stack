# Application alerts

## Dashboard

The alerts described in this runbook correspond to the **Application alerts dashboard**.

This dashboard provides a **high-level overview of application health** and is used to investigate alerts related to the demo application.

![Application alerts dashboard](../images/application-alerts.png)

The dashboard includes the following panels:

- demo application health
- HTTP 5xx error rate
- inflight requests
- P95 request latency
- HTTP status distribution

These panels provide the most important signals for quickly identifying application issues.

---

## Application monitoring dashboards

Two dashboards are available for application observability:

| Dashboard | Purpose |
|------|------|
| **Application alerts** | quick investigation when application alerts fire |
| **Application metrics** | deeper application metrics exploration |

The **Application alerts dashboard** focuses on the most important signals that correlate directly with alert rules.

For deeper investigation engineers can explore the raw metrics directly in Prometheus or Grafana.

---

## Contents

- [DemoAppDown](#demoappdown)
- [DemoAppHigh5xxRate](#demoapphigh5xxrate)
- [DemoAppHighP95Latency](#demoappp95latency)
- [DemoAppHighInflight](#demoapphighinflight)

---

## DemoAppDown

**Severity:** critical

### Description

Prometheus cannot scrape `demo-app`.

### Investigation

Check container status:

```
docker compose ps demo-app
```

Check health endpoint:

```
curl http://demo-app:8081/healthz
```

Check metrics endpoint:

```
curl http://demo-app:8081/metrics
```

Inspect logs:

```
docker logs --tail 200 demo-app
```

Check container network:

```
docker inspect demo-app
```

---

## DemoAppHigh5xxRate

**Severity:** warning

### Description

The application is returning an elevated rate of HTTP 5xx responses.

### Investigation

Check 5xx rate in Prometheus:

```
sum(rate(http_requests_total{service="demo-app",status=~"5.."}[2m]))
```

Inspect status code distribution:

```
sum by (status) (rate(http_requests_total{service="demo-app"}[2m]))
```

Identify failing endpoints:

```
sum by (path,status) (rate(http_requests_total{service="demo-app"}[2m]))
```

Check logs in Grafana/Loki:

```
{service_name="demo-app"} | json | status >= 500
```

---

## DemoAppHighP95Latency

**Severity:** warning

### Description

The 95th percentile request latency is above the expected threshold.

### Investigation

Check latency in Prometheus:

```
histogram_quantile(
  0.95,
  sum by (le)(
    rate(http_request_duration_seconds_bucket{service="demo-app"}[5m])
  )
)
```

Check inflight requests:

```
http_inflight_requests{service="demo-app"}
```

Investigate slow requests in logs:

```
{service_name="demo-app"} | json | duration_ms > 500
```

---

## DemoAppHighInflight

**Severity:** warning

### Description  

The number of concurrent requests handled by the application is unusually high.

### Investigation

Check inflight requests:

```
http_inflight_requests{service="demo-app"}
```

Check traffic rate:

```
sum(rate(http_requests_total{service="demo-app"}[1m]))
```

---

