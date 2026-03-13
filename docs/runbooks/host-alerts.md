# Host alerts

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

