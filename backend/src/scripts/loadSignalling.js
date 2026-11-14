// Signalling load test: many one-to-one classes at once against a running API.
//
//   node src/scripts/loadSignalling.js --url http://127.0.0.1:4000 --pairs 100 --seconds 30 [--rate 10] [--pid <server pid>]
//
// For each pair it registers a teacher and a student, the teacher opens an instant class with the
// student invited, both join over Socket.IO, and the teacher sends `--rate` signalling messages a
// second to the student (as during ICE negotiation and renegotiation) while both share media state.
// It reports join latency, relay latency (send → receive, same clock) and errors, and the server's
// CPU and memory when its pid is given (read from /proc, Linux only).
//
// Run it against a disposable server: it creates real accounts. The server needs
// REQUIRE_EMAIL_VERIFICATION=false and a high RATE_LIMIT_MULTIPLIER (every client shares one IP).
// Media is not tested here: it flows peer-to-peer, or through mediasoup, never through signalling.
import fs from 'node:fs';
import { io } from 'socket.io-client';

const args = Object.fromEntries(
  process.argv
    .slice(2)
    .join(' ')
    .split('--')
    .filter(Boolean)
    .map((kv) => kv.trim().split(/\s+/)),
);
const URL_ = args.url || 'http://127.0.0.1:4000';
const PAIRS = Number(args.pairs || 50);
const SECONDS = Number(args.seconds || 20);
const RATE = Number(args.rate || 10);
const PID = args.pid ? Number(args.pid) : null;
const run = Date.now().toString(36);

const pct = (xs, p) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))];
};
const fmt = (xs) => `p50 ${pct(xs, 50)?.toFixed(1)} ms · p95 ${pct(xs, 95)?.toFixed(1)} ms · p99 ${pct(xs, 99)?.toFixed(1)} ms · max ${Math.max(...xs).toFixed(1)} ms (n=${xs.length})`;

async function http(path, { method = 'GET', body, token } = {}) {
  const res = await fetch(`${URL_}/api${path}`, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const json = res.status === 204 ? null : await res.json();
  if (!res.ok) throw new Error(`${method} ${path}: ${res.status} ${JSON.stringify(json?.error || json)}`);
  return json;
}
const register = (role, i) => http('/auth/register', { method: 'POST', body: { name: `Load ${role} ${i}`, email: `load-${run}-${role}-${i}@example.test`, password: 'Load-Passw0rd!', role } });

function procStats() {
  if (!PID) return null;
  try {
    const stat = fs.readFileSync(`/proc/${PID}/stat`, 'utf8').split(') ')[1].split(' ');
    const status = fs.readFileSync(`/proc/${PID}/status`, 'utf8');
    return { cpuTicks: Number(stat[11]) + Number(stat[12]), rssMb: Number(status.match(/VmRSS:\s+(\d+)/)[1]) / 1024 };
  } catch {
    return null;
  }
}

const connect = (token) =>
  new Promise((resolve, reject) => {
    const s = io(URL_, { auth: { token }, transports: ['websocket'], reconnection: false, forceNew: true });
    s.once('connect', () => resolve(s));
    s.once('connect_error', reject);
  });
const ack = (s, ev, payload) => new Promise((resolve) => s.emit(ev, payload, resolve));

const joinMs = [];
const relayMs = [];
const errors = new Map();
const fail = (what, err) => errors.set(`${what}: ${err?.message || err}`.slice(0, 160), (errors.get(`${what}: ${err?.message || err}`.slice(0, 160)) || 0) + 1);
let sent = 0;
let received = 0;

console.log(`Signalling load test: ${PAIRS} classes (${PAIRS * 2} sockets), ${SECONDS}s, ${RATE} signals/s per class → ${URL_}`);

// 1. accounts and classes (sequential batches: registration is deliberately slow, bcrypt)
const pairs = [];
const t0 = Date.now();
for (let i = 0; i < PAIRS; i += 10) {
  const batch = await Promise.all(
    Array.from({ length: Math.min(10, PAIRS - i) }, async (_, k) => {
      const n = i + k;
      try {
        const [t, s] = await Promise.all([register('teacher', n), register('student', n)]);
        const { meeting } = await http('/meetings', { method: 'POST', token: t.accessToken, body: { type: 'instant', invitees: [s.user.email] } });
        return { n, teacher: t, student: s, code: meeting.code };
      } catch (err) {
        fail('setup', err);
        return null;
      }
    }),
  );
  pairs.push(...batch.filter(Boolean));
}
console.log(`  set up ${pairs.length} classes in ${((Date.now() - t0) / 1000).toFixed(1)}s`);

// 2. everyone joins at once
const before = procStats();
const tJoin = Date.now();
const live = (
  await Promise.all(
    pairs.map(async (p) => {
      try {
        const started = performance.now();
        const [hs, ss] = await Promise.all([connect(p.teacher.accessToken), connect(p.student.accessToken)]);
        const hj = await http(`/meetings/${p.code}/join`, { method: 'POST', token: p.teacher.accessToken, body: {} });
        const h = await ack(hs, 'meeting:join', { joinToken: hj.joinToken });
        if (!h?.ok) throw new Error(h?.error?.code || 'host join failed');
        const sj = await http(`/meetings/${p.code}/join`, { method: 'POST', token: p.student.accessToken, body: {} });
        const s = await ack(ss, 'meeting:join', { joinToken: sj.joinToken });
        if (s?.status !== 'admitted') throw new Error(`student ${s?.status || s?.error?.code}`);
        joinMs.push(performance.now() - started);
        ss.on('p2p:signal', ({ data }) => {
          received += 1;
          relayMs.push(performance.now() - Number(data.pcId.slice(3)) / 1000);
        });
        return { ...p, hs, ss };
      } catch (err) {
        fail('join', err);
        return null;
      }
    }),
  )
).filter(Boolean);
console.log(`  ${live.length}/${pairs.length} classes live in ${((Date.now() - tJoin) / 1000).toFixed(1)}s`);

// 3. sustained signalling: each teacher → student at RATE/s, plus a media-state change every 2s
const tRun = Date.now();
const timers = live.map((p, i) => {
  const offset = (i / live.length) * (1000 / RATE); // spread sends across the interval
  let tick = 0;
  return setTimeout(() => {
    p.timer = setInterval(async () => {
      tick += 1;
      // the pcId carries the send time (µs), so the receiver measures relay latency on the same clock
      const pcId = `pc-${Math.round(performance.now() * 1000)}`;
      sent += 1;
      const r = await ack(p.hs, 'p2p:signal', { to: p.student.user.id, data: { pcId, type: 'candidate', candidate: { candidate: 'candidate:1 1 udp 2122260223 192.0.2.1 54400 typ host', sdpMid: '0', sdpMLineIndex: 0 } } });
      if (!r?.ok) fail('signal', r?.error?.code || 'no ack');
      if (tick % (2 * RATE) === 0) ack(p.ss, 'media:state', { audio: tick % 4 === 0, video: true });
    }, 1000 / RATE);
  }, offset);
});
await new Promise((r) => setTimeout(r, SECONDS * 1000));
timers.forEach(clearTimeout);
live.forEach((p) => clearInterval(p.timer));
await new Promise((r) => setTimeout(r, 1500));
const after = procStats();
const elapsed = (Date.now() - tRun) / 1000;

console.log('\nResults');
console.log(`  join (connect both, REST join token, socket join, admitted): ${fmt(joinMs)}`);
console.log(`  relay (teacher emit → student receive):                     ${fmt(relayMs)}`);
console.log(`  signals: sent ${sent}, received ${received} (${((received / Math.max(1, sent)) * 100).toFixed(2)}%), ${(received / elapsed).toFixed(0)} msg/s through the server`);
if (before && after) {
  const hz = 100; // USER_HZ on Linux
  console.log(`  server: CPU ${(((after.cpuTicks - before.cpuTicks) / hz / elapsed) * 100).toFixed(0)}% of one core during the run · RSS ${after.rssMb.toFixed(0)} MB`);
}
console.log(errors.size ? `  errors:\n${[...errors].map(([e, n]) => `    ${n} × ${e}`).join('\n')}` : '  errors: none');

// 4. leave cleanly
await Promise.all(live.map(async (p) => Promise.all([ack(p.hs, 'meeting:leave'), ack(p.ss, 'meeting:leave')]).catch(() => {})));
live.forEach((p) => {
  p.hs.close();
  p.ss.close();
});
process.exit(errors.size ? 1 : 0);
