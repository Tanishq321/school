import { useEffect, useState } from 'react';

let sharedCtx;
const getCtx = () => {
  if (!sharedCtx) {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return null;
    sharedCtx = new Ctx();
  }
  if (sharedCtx.state === 'suspended') sharedCtx.resume().catch(() => {});
  return sharedCtx;
};

/**
 * 0..1 loudness of an audio track. Used for speaking indicators and the mic meter.
 * ~43 ms analysis window, sampled every 90 ms (not a divisor of common beat periods, so short
 * sounds aren't systematically missed), with peak-hold decay so brief syllables stay visible.
 */
export function useAudioLevel(track, enabled = true) {
  const [level, setLevel] = useState(0);
  useEffect(() => {
    if (!track || !enabled || track.readyState === 'ended') {
      setLevel(0);
      return undefined;
    }
    const ctx = getCtx();
    if (!ctx) return undefined;
    let source;
    try {
      source = ctx.createMediaStreamSource(new MediaStream([track]));
    } catch {
      return undefined;
    }
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 2048;
    source.connect(analyser);
    const buf = new Uint8Array(analyser.fftSize);
    let held = 0;
    const timer = setInterval(() => {
      analyser.getByteTimeDomainData(buf);
      let sum = 0;
      let peak = 0;
      for (let i = 0; i < buf.length; i += 1) {
        const v = (buf[i] - 128) / 128;
        sum += v * v;
        peak = Math.max(peak, Math.abs(v));
      }
      const now = Math.min(1, Math.max(Math.sqrt(sum / buf.length) * 4, peak * 0.8));
      held = Math.max(now, held * 0.6);
      setLevel(held < 0.01 ? 0 : held);
    }, 90);
    return () => {
      clearInterval(timer);
      source.disconnect();
    };
  }, [track, enabled]);
  return level;
}
