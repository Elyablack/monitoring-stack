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

Two main investigation surfaces are available for application observability:

| Dashboard | Purpose |
|------|------|
| **Application alerts** | quick investigation when application alerts fire |
| **Demo app UI** | reproduce demo traffic, inspect alert preview, inspect button logs |

The **Application alerts dashboard** focuses on the most important signals that correlate directly with alert rules.

For deeper investigation engineers can explore the raw metrics directly in Prometheus or Grafana.

---

## Scope

This runbook covers **application-level warning and critical alerts**.

These alerts represent sustained or meaningful application conditions such as:

- service unavailability
- elevated 5xx error rate
- high request latency
- unusually high inflight request count

This runbook does **not** cover fast demo-only alerts such as:

- `DemoAppButtonError503`
- `DemoAppButtonSlow`

Those are documented separately in:

- [Demo alerts](demo-alerts.md)

However, demo scenarios may still contribute to the application signals described here if traffic volume and evaluation windows are sufficient.

---

## Contents

- [DemoAppDown](#demoappdown)
- [DemoAppHigh5xxRate](#demoapphigh5xxrate)
- [DemoAppHighP95Latency](#demoapphighp95latency)
- [DemoAppHighInflight](#demoapphighinflight)

---

## DemoAppDown

**Severity:** critical

### Description

Prometheus cannot scrape `demo-app`.

This usually indicates one of the following:

- the application is down
- the container is unhealthy
- the metrics endpoint is unavailable
- there is a network or scrape-path issue

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

Check Prometheus scrape status:

```
curl http://127.0.0.1:9090/api/v1/targets | jq
```

### Resolution

Typical fixes include:

- restart the container
- fix the app process
- fix the metrics endpoint
- fix scrape target configuration
- restore container networking

---

## DemoAppHigh5xxRate

**Severity:** warning

### Description

The application is returning an elevated rate of HTTP 5xx responses.

This alert reflects a real application error condition over the rule evaluation window.

It is distinct from the fast demo alert DemoAppButtonError503.

### Possible causes

- handler failures
- upstream dependency issues
- intentional demo traffic
- overload or resource pressure
- bad application deployment state

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

Check logs in Grafana or Loki:

```
{service_name="demo-app"} | json | status >= 500
```

Check recent demo traffic if validating manually:

- review the demo app UI
- review button logs
- confirm whether a demo scenario was intentionally run

### Resolution

Typical fixes include:

- identify the failing endpoint
- inspect application logs
- inspect dependency failures
- reduce or stop artificial demo traffic
- restart or redeploy the service if necessary

### Notes

A short demo 503 burst may trigger the fast demo alert without triggering this warning alert.

This warning alert usually requires more sustained error traffic.

---

## DemoAppHighP95Latency

**Severity:** warning

### Description

The 95th percentile request latency is above the expected threshold.

This alert reflects a sustained latency condition over the evaluation window.

It is distinct from the fast demo alert DemoAppButtonSlow.

### Possible causes

- slow application code path
- downstream dependency latency
- queueing under load
- high inflight request count
- intentionally generated slow demo traffic

### Investigation

Check latency in Prometheus:

```
histogram_quantile(
  0.95,
  sum by (le) (
    rate(http_request_duration_seconds_bucket{service="demo-app"}[5m])
  )
)
```

Check inflight requests:

```
http_inflight_requests{service="demo-app"}
```

Check traffic rate:

```
sum(rate(http_requests_total{service="demo-app"}[1m]))
```

Investigate slow requests in logs:

```
{service_name="demo-app"} | json | duration_ms > 500
```

If validating a demo scenario, also check:

- current slow ms
- burst count
- interval
- whether the latency demo was run recently

### Resolution

Typical fixes include:

- identify slow endpoints
- inspect dependency calls
- reduce concurrent pressure
- optimize slow paths
- stop or separate demo traffic from validation windows

### Notes

A few slow demo requests may trigger the fast demo alert without causing this warning alert.

This warning alert generally requires enough sustained slow traffic to shift the histogram-based P95 signal.

---

## DemoAppHighInflight

**Severity:** warning

### Description

The number of concurrent requests handled by the application is unusually high.

This alert is useful for detecting pressure, queueing, or traffic buildup.

### Possible causes

- burst traffic
- slow handlers
- blocked worker capacity
- downstream backpressure
- intentionally generated demo load

### Investigation

Check inflight requests:

```
http_inflight_requests{service="demo-app"}
```

Check traffic rate:

```
sum(rate(http_requests_total{service="demo-app"}[1m]))
```

Inspect latency together with inflight count:

```
histogram_quantile(
  0.95,
  sum by (le) (
    rate(http_request_duration_seconds_bucket{service="demo-app"}[5m])
  )
)
```

Inspect recent request patterns in logs.

If demo traffic was recently triggered, confirm whether the load was expected.

### Resolution

Typical fixes include:

- reduce or stop artificial burst traffic
- investigate slow handlers
- inspect resource saturation
- inspect downstream dependencies
- restart the service if it became wedged

---

## Relationship to demo alerts

The demo UI can intentionally generate traffic that affects these alerts.

Typical relationship:

- [`DemoAppButtonError503`](demo-alerts.md#demoappbuttonerror503) is a fast demo alert
- `DemoAppHigh5xxRate` is a longer warning alert
- [`DemoAppButtonSlow`](demo-alerts.md#demoappbuttonslow) is a fast demo alert
- `DemoAppHighP95Latency` is a longer warning alert

This means:
- fast demo alerts may appear first
- warning alerts may appear later
- warning alerts may not appear at all if the demo scenario is too short

For fast demo alert handling, use:

- [Demo alerts](demo-alerts.md)
