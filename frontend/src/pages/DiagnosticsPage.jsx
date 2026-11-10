import { useState } from 'react';
import { CheckCircle2, CircleAlert, CircleX, Play } from 'lucide-react';
import { api } from '../services/api.js';
import { Button, Spinner } from '../components/ui/index.jsx';

const withTimeout = (p, ms, msg) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error(msg)), ms))]);

/** Gathers ICE candidates for a throwaway connection and reports their types. */
async function gather(iceServers, policy) {
  const pc = new RTCPeerConnection({ iceServers, iceTransportPolicy: policy });
  const found = [];
  pc.createDataChannel('probe');
  const done = new Promise((resolve) => {
    pc.onicecandidate = (e) => {
      if (e.candidate?.candidate) {
        const type = / typ (\w+)/.exec(e.candidate.candidate)?.[1];
        const proto = e.candidate.protocol || / (udp|tcp) /i.exec(e.candidate.candidate)?.[1];
        found.push({ type, proto: proto?.toLowerCase(), address: e.candidate.address });
      } else if (!e.candidate) resolve();
    };
    pc.onicegatheringstatechange = () => pc.iceGatheringState === 'complete' && resolve();
  });
  await pc.setLocalDescription(await pc.createOffer());
  await withTimeout(done, 10_000, 'timeout').catch(() => {});
  pc.close();
  return found;
}

/** Two local peers that may only talk through TURN: proves the relay works end to end. */
async function relayLoopback(iceServers) {
  const cfg = { iceServers, iceTransportPolicy: 'relay' };
  const a = new RTCPeerConnection(cfg);
  const b = new RTCPeerConnection(cfg);
  a.onicecandidate = (e) => e.candidate && b.addIceCandidate(e.candidate).catch(() => {});
  b.onicecandidate = (e) => e.candidate && a.addIceCandidate(e.candidate).catch(() => {});
  const started = performance.now();
  const ch = a.createDataChannel('ping');
  const got = new Promise((resolve) => {
    b.ondatachannel = ({ channel }) => (channel.onmessage = (m) => resolve(m.data));
  });
  const open = new Promise((resolve) => (ch.onopen = resolve));
  await a.setLocalDescription(await a.createOffer());
  await b.setRemoteDescription(a.localDescription);
  await b.setLocalDescription(await b.createAnswer());
  await a.setRemoteDescription(b.localDescription);
  try {
    await withTimeout(open, 15_000, 'Could not connect through the relay within 15 s');
    ch.send('ping');
    await withTimeout(got, 5000, 'Relay connected but data did not arrive');
    return Math.round(performance.now() - started);
  } finally {
    a.close();
    b.close();
  }
}

export default function DiagnosticsPage() {
  const [results, setResults] = useState([]);
  const [running, setRunning] = useState(false);

  const run = async () => {
    setRunning(true);
    const out = [];
    const push = (r) => {
      out.push(r);
      setResults([...out]);
    };

    push({ name: 'Secure connection (HTTPS)', status: window.isSecureContext ? 'pass' : 'fail', detail: window.isSecureContext ? 'Camera and microphone can be used.' : 'Open the site over https.' });
    const rtc = typeof RTCPeerConnection !== 'undefined';
    push({ name: 'WebRTC support', status: rtc ? 'pass' : 'fail', detail: rtc ? navigator.userAgent.match(/(Chrome|Firefox|Safari|Edg)\/[\d.]+/)?.[0] : 'This browser cannot make video calls.' });
    push({
      name: 'Screen sharing support',
      status: navigator.mediaDevices?.getDisplayMedia ? 'pass' : 'warn',
      detail: navigator.mediaDevices?.getDisplayMedia ? 'Available (used from Phase 3).' : 'Not available in this browser (typical on mobile).',
    });

    try {
      const s = await navigator.mediaDevices.getUserMedia({ audio: true, video: true });
      const labels = s.getTracks().map((t) => `${t.kind}: ${t.label || 'default'}`);
      s.getTracks().forEach((t) => t.stop());
      push({ name: 'Camera & microphone', status: 'pass', detail: labels.join(' · ') });
    } catch (err) {
      push({ name: 'Camera & microphone', status: 'fail', detail: `${err.name}: ${err.message}` });
    }

    if (!rtc) return setRunning(false);
    let ice;
    try {
      ice = await api('/diagnostics/ice');
      const turn = ice.iceServers.find((s) => [].concat(s.urls).some((u) => u.startsWith('turn')));
      push({ name: 'TURN credentials', status: turn ? 'pass' : 'warn', detail: turn ? `Issued for ${Math.round(ice.ttlSeconds / 60)} min · ${[].concat(turn.urls).join(', ')}` : 'No TURN server configured: some networks will not connect.' });
    } catch (err) {
      push({ name: 'TURN credentials', status: 'fail', detail: err.message });
      return setRunning(false);
    }

    const all = await gather(ice.iceServers, 'all');
    const types = [...new Set(all.map((c) => c.type))];
    push({
      name: 'Network paths (ICE)',
      status: types.includes('srflx') || types.includes('relay') ? 'pass' : 'warn',
      detail: `Found: ${types.join(', ') || 'none'}. host = local network, srflx = public address via STUN, relay = TURN.`,
    });

    const relays = await gather(ice.iceServers, 'relay');
    const protos = [...new Set(relays.map((c) => c.proto))];
    push({
      name: 'TURN relay allocation',
      status: relays.length ? 'pass' : 'fail',
      detail: relays.length ? `Relay candidates over ${protos.join(' & ')}` : 'TURN server unreachable or rejected our credentials. Check firewall ports and the shared secret.',
    });

    if (relays.length) {
      try {
        const ms = await relayLoopback(ice.iceServers);
        push({ name: 'Media through relay', status: 'pass', detail: `Connected and exchanged data via TURN in ${ms} ms.` });
      } catch (err) {
        push({ name: 'Media through relay', status: 'fail', detail: err.message });
      }
    }
    setRunning(false);
    return undefined;
  };

  return (
    <div className="mx-auto max-w-2xl">
      <h1 className="font-display text-3xl font-semibold">Connection test</h1>
      <p className="mt-2 text-ink-2 dark:text-slate-400">Checks your browser, devices and whether calls can get through your network, including via our relay server.</p>
      <Button className="mt-6" onClick={run} loading={running}>
        <Play size={16} /> {results.length ? 'Run again' : 'Run test'}
      </Button>
      <ul className="mt-6 space-y-2" data-testid="diagnostics-results">
        {results.map((r) => (
          <li key={r.name} className="card flex items-start gap-3 p-4" data-status={r.status}>
            {r.status === 'pass' ? <CheckCircle2 className="shrink-0 text-brand-500" /> : r.status === 'warn' ? <CircleAlert className="shrink-0 text-saffron" /> : <CircleX className="shrink-0 text-danger" />}
            <div className="min-w-0">
              <p className="font-medium">{r.name}</p>
              <p className="text-sm break-words text-ink-2 dark:text-slate-400">{r.detail}</p>
            </div>
          </li>
        ))}
        {running && (
          <li className="flex items-center gap-2 p-4 text-sm text-ink-2">
            <Spinner size={16} /> Testing…
          </li>
        )}
      </ul>
    </div>
  );
}
