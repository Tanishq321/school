# Monitoring

Everything here runs on your own machines. No hosted monitoring service is required.

## 1. What to watch

| Signal | Where | Act when |
|---|---|---|
| Is it up? | `GET /api/health` (200 / 503) | not 200 for 2 minutes |
| Database | `schole_db_up` | 0 |
| Media server | `schole_media_workers` | fewer than you configured |
| API latency | `schole_http_request_duration_seconds` | p95 above 1 s for 10 minutes |
| Server errors | `…_count{status="5xx"}` | any sustained rate |
| Event loop | `schole_event_loop_delay_p99_seconds` | above 0.2 s (the process is starved) |
| Memory | `schole_process_resident_memory_bytes` | keeps climbing across days |
| Failed sign-ins | admin console → Security, or `auditlogs` | a burst (someone guessing passwords) |
| Recording disk | admin console → System | below 10 GB free |
| TURN | coturn's own Prometheus endpoint (`127.0.0.1:9641`) | allocation errors |

The administrator console (**Administration → Overview**) shows the same numbers live, refreshed every 15 seconds.

## 2. Prometheus endpoint

Off by default. Set a token and restart:

```ini
METRICS_TOKEN=<random 32+ characters>
```

`GET /metrics` then answers only requests carrying `Authorization: Bearer <token>`; anything else gets 404. It exposes counts and timings only: no names, emails, class titles or codes.

```yaml
# prometheus.yml
scrape_configs:
  - job_name: schole
    scheme: https
    metrics_path: /metrics
    authorization: { type: Bearer, credentials: "<METRICS_TOKEN>" }
    static_configs: [{ targets: ["class.example.com"] }]
  - job_name: coturn
    static_configs: [{ targets: ["127.0.0.1:9641"] }]
```

If Prometheus runs on the same host, scrape `http://127.0.0.1:4000/metrics` and block `/metrics` in Nginx (`location = /metrics { return 404; }`).

## 3. Alert rules

```yaml
groups:
  - name: schole
    rules:
      - alert: ScholeDown
        expr: up{job="schole"} == 0 or schole_db_up == 0
        for: 2m
      - alert: ScholeMediaWorkerLost
        expr: schole_media_workers < 1   # set to your MEDIASOUP_NUM_WORKERS
        for: 1m
      - alert: ScholeSlow
        expr: histogram_quantile(0.95, sum by (le) (rate(schole_http_request_duration_seconds_bucket[5m]))) > 1
        for: 10m
      - alert: ScholeErrors
        expr: sum(rate(schole_http_request_duration_seconds_count{status="5xx"}[5m])) > 0.05
        for: 5m
      - alert: ScholeEventLoopStarved
        expr: schole_event_loop_delay_p99_seconds > 0.2
        for: 5m
```

## 4. Logs

- The API writes JSON lines (pino) to stdout: `pm2 logs video-platform-api`. Rotate with `pm2 install pm2-logrotate`.
- Authorization headers and cookies are redacted. Passwords, codes and tokens are never logged.
- The audit trail (`auditlogs`, and **Administration → Audit trail**) is the record of who did what: sign-ins, failures, lockouts, two-step changes, administrator actions, class and recording events.

## 5. Not included

No bundled Grafana dashboards or log shipping, and no error-tracking service. The metrics above work with any Prometheus-compatible stack you already run.
