import { monitorEventLoopDelay } from 'node:perf_hooks';
import mongoose from 'mongoose';
import { rooms } from '../sockets/realtime.js';
import { workerPool } from '../mediasoup/workerPool.js';

/**
 * A small in-process metrics registry, exported in the Prometheus text format at GET /metrics
 * and summarised for the admin console. No third-party monitoring service involved.
 */
const BUCKETS = [0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5];
const http = new Map(); // "METHOD|group|statusClass" -> { count, sum, buckets[] }
const counters = new Map(); // name -> { help, values: Map(labelString -> n) }
const startedAt = Date.now();
const loop = monitorEventLoopDelay({ resolution: 20 });
loop.enable();

/** Collapse paths so codes and ids don't explode the label space. */
function group(path) {
  const m = /^\/api\/([a-z-]+)/.exec(path);
  return m ? m[1] : 'other';
}

export function httpMetrics(req, res, next) {
  const start = process.hrtime.bigint();
  res.on('finish', () => {
    const sec = Number(process.hrtime.bigint() - start) / 1e9;
    const key = `${req.method}|${group(req.originalUrl)}|${Math.floor(res.statusCode / 100)}xx`;
    let e = http.get(key);
    if (!e) http.set(key, (e = { count: 0, sum: 0, buckets: BUCKETS.map(() => 0) }));
    e.count += 1;
    e.sum += sec;
    BUCKETS.forEach((b, i) => sec <= b && (e.buckets[i] += 1));
  });
  next();
}

export function count(name, help, labels = {}) {
  let c = counters.get(name);
  if (!c) counters.set(name, (c = { help, values: new Map() }));
  const key = Object.entries(labels).map(([k, v]) => `${k}="${String(v).replace(/["\\\n]/g, '')}"`).join(',');
  c.values.set(key, (c.values.get(key) || 0) + 1);
}

/** Point-in-time numbers shared by /metrics and the admin console. */
export function snapshot(io) {
  let participants = 0;
  let waiting = 0;
  let recording = 0;
  for (const r of rooms.values()) {
    participants += r.members.size;
    waiting += r.waiting.size;
    if (r.recording) recording += 1;
  }
  const mem = process.memoryUsage();
  let requests = 0;
  let errors = 0;
  let sum = 0;
  for (const [key, e] of http) {
    requests += e.count;
    sum += e.sum;
    if (key.endsWith('5xx')) errors += e.count;
  }
  return {
    uptimeSec: Math.round((Date.now() - startedAt) / 1000),
    liveClasses: [...rooms.values()].filter((r) => r.members.size > 0).length,
    participants,
    waiting,
    recordingNow: recording,
    sockets: io?.engine?.clientsCount ?? 0,
    mediaMode: workerPool.ready ? 'sfu' : 'p2p',
    mediaWorkers: workerPool.status(),
    db: mongoose.connection.readyState === 1 ? 'up' : 'down',
    memoryRssMb: Math.round(mem.rss / 1048576),
    heapUsedMb: Math.round(mem.heapUsed / 1048576),
    eventLoopP99Ms: Math.round(loop.percentile(99) / 1e6),
    requests,
    serverErrors: errors,
    avgResponseMs: requests ? Math.round((sum / requests) * 1000) : 0,
    node: process.version,
  };
}

export function renderPrometheus(io) {
  const s = snapshot(io);
  const out = [];
  const gauge = (name, help, value) => out.push(`# HELP ${name} ${help}`, `# TYPE ${name} gauge`, `${name} ${value}`);
  gauge('schole_up', 'Always 1 while the process is serving', 1);
  gauge('schole_uptime_seconds', 'Process uptime', s.uptimeSec);
  gauge('schole_db_up', 'Database connection (1 = up)', s.db === 'up' ? 1 : 0);
  gauge('schole_live_classes', 'Classes with at least one person in the room', s.liveClasses);
  gauge('schole_participants', 'People currently in classes', s.participants);
  gauge('schole_waiting', 'People currently in waiting rooms', s.waiting);
  gauge('schole_recordings_active', 'Classes being recorded right now', s.recordingNow);
  gauge('schole_sockets', 'Open signalling connections', s.sockets);
  gauge('schole_media_workers', 'mediasoup workers alive', s.mediaWorkers.filter((w) => !w.closed).length);
  gauge('schole_process_resident_memory_bytes', 'Resident memory', s.memoryRssMb * 1048576);
  gauge('schole_event_loop_delay_p99_seconds', 'Event-loop delay, 99th percentile', s.eventLoopP99Ms / 1000);
  out.push('# HELP schole_http_request_duration_seconds API latency', '# TYPE schole_http_request_duration_seconds histogram');
  for (const [key, e] of http) {
    const [method, route, status] = key.split('|');
    const l = `method="${method}",route="${route}",status="${status}"`;
    BUCKETS.forEach((b, i) => out.push(`schole_http_request_duration_seconds_bucket{${l},le="${b}"} ${e.buckets[i]}`));
    out.push(`schole_http_request_duration_seconds_bucket{${l},le="+Inf"} ${e.count}`, `schole_http_request_duration_seconds_sum{${l}} ${e.sum.toFixed(6)}`, `schole_http_request_duration_seconds_count{${l}} ${e.count}`);
  }
  for (const [name, c] of counters) {
    out.push(`# HELP ${name} ${c.help}`, `# TYPE ${name} counter`);
    for (const [labels, v] of c.values) out.push(`${name}${labels ? `{${labels}}` : ''} ${v}`);
  }
  return `${out.join('\n')}\n`;
}
