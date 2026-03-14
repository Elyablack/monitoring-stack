# Host alerts

## Dashboard

The alerts described in this runbook correspond to the **Host alerts dashboard**.

This dashboard provides a **high-level overview of host health** and is intended for quick investigation when an alert fires.

![Host alerts dashboard](../images/dashboards/host-alerts.png)

The dashboard includes panels for:

- node exporter health
- root filesystem usage
- memory usage
- CPU usage
- time since reboot

These panels provide the most important host signals needed for rapid triage.

---

## Host monitoring dashboards

Two dashboards are available for host monitoring:

| Dashboard | Purpose |
|------|------|
| **Host alerts** | quick investigation when an alert fires |
| **Node exporter full** | detailed host diagnostics and full host metrics |

The **Node exporter full dashboard** contains the complete set of metrics exported by node_exporter, including:

- CPU metrics
- memory metrics
- filesystem usage
- disk I/O
- network traffic
- system load
- kernel metrics

It is intended for **deep investigation** after an alert has fired.

The dashboard does **not contain alert rules** and is used purely for observability and troubleshooting.

---

## Contents

- [NodeExporterDown](#nodeexporterdown)
- [HostLowDiskSpace](#hostlowdiskspace)
- [HostMemoryPressure](#hostmemorypressure)
- [HostHighCpuLoad](#hosthighcpuload)
- [HostRebootDetected](#hostrebootdetected)

---

## NodeExporterDown

**Severity:** critical

### Description

Prometheus cannot scrape `node_exporter` metrics.

### Possible causes:

- host unreachable
- exporter stopped
- network issue
- configuration error

### Investigation

Check connectivity:

```
ping <host>
```

Try SSH:

```
ssh <host>
```

If the host is unreachable check:

- network connectivity
- VPS status
- Tailscale connectivity
- recent reboot events

Check exporter endpoint:

```
curl http://<host>:9100/metrics
```

If the exporter endpoint is not reachable:

```
systemctl status node_exporter
```

If exporter runs in a container:

```
docker ps
docker logs <node-exporter>
```

Check Prometheus scrape status:

```
curl http://127.0.0.1:9090/api/v1/targets | jq
```

Or via Prometheus UI:

Status → Targets

---

## HostLowDiskSpace

**Severity:** critical

### Description

Filesystem free space below **10%**.

### Investigation

Check filesystem usage:

```
df -h
```

Check inode usage:

```
df -i
```

Find large directories:

```
du -sh /* | sort -h
```

Inspect log usage:

```
du -sh /var/log/*
```

Check Docker storage:

```
docker system df
```

Inspect Docker resources:

```
docker images
docker volumes
docker containers
```

### Resolution

Possible cleanup actions:

- remove unused Docker images
- rotate logs
- remove temporary files
- remove old backups

Do **not remove**:

- database volumes
- active backups
- required application logs

---

## HostMemoryPressure

**Severity:** warning

### Description

Available system memory is critically low.

### Investigation

Check memory usage:

```
free -h
```

Find memory-heavy processes:

```
ps aux --sort=-%mem | head
```

Check for OOM events:

```
dmesg | grep -i oom
```

or

```
journalctl -k | grep -i oom
```

Inspect container memory usage:

```
docker stats
```

---

## HostHighCpuLoad

**Severity:** warning

### Description

CPU load on the host is unusually high.

### Investigation

Check CPU usage:

```
top
```

or

```
htop
```

Find CPU-heavy processes:

```
ps aux --sort=-%cpu | head
```

Check system load:

```
uptime
```

Inspect container resource usage:

```
docker stats
```

---

## HostRebootDetected

**Severity:** warning

### Description

Prometheus detected reboot via metric:

```
node_boot_time_seconds
```

### Investigation

Check uptime:

```
uptime
```

Check reboot history:

```
last reboot
```

Inspect logs from the previous boot:

```
journalctl -b -1
```

Verify that services restarted correctly:

```
docker ps
```

---

