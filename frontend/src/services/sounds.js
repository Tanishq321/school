/**
 * Synthesised interface sounds: one tonal family (FM bells around A5), short envelopes,
 * quiet by default. No audio files are downloaded.
 */
const KEY = 'vp.sounds';
let ctx;
let enabled = (() => {
  try {
    return localStorage.getItem(KEY) !== 'off';
  } catch {
    return true;
  }
})();

export const soundsEnabled = () => enabled;
export function setSoundsEnabled(on) {
  enabled = on;
  try {
    localStorage.setItem(KEY, on ? 'on' : 'off');
  } catch {
    /* ignore */
  }
}

function audio() {
  if (!ctx) {
    const C = window.AudioContext || window.webkitAudioContext;
    if (!C) return null;
    ctx = new C();
  }
  if (ctx.state === 'suspended') ctx.resume().catch(() => {});
  return ctx;
}

/** A single FM bell partial: carrier + modulator, exponential decay. */
function bell(freq, at, { dur = 0.6, gain = 0.06, ratio = 3.5, index = 2.2 } = {}) {
  const a = audio();
  if (!a) return;
  const t = a.currentTime + at;
  const out = a.createGain();
  out.gain.setValueAtTime(0.0001, t);
  out.gain.exponentialRampToValueAtTime(gain, t + 0.008);
  out.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  const car = a.createOscillator();
  car.frequency.value = freq;
  const mod = a.createOscillator();
  mod.frequency.value = freq * ratio;
  const modGain = a.createGain();
  modGain.gain.setValueAtTime(freq * index, t);
  modGain.gain.exponentialRampToValueAtTime(1, t + dur * 0.7);
  mod.connect(modGain).connect(car.frequency);
  // A soft low-pass keeps the bell warm rather than glassy.
  const lp = a.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = 3800;
  car.connect(lp).connect(out).connect(a.destination);
  car.start(t);
  mod.start(t);
  car.stop(t + dur + 0.05);
  mod.stop(t + dur + 0.05);
}

const CUES = {
  join: () => {
    bell(659.25, 0, { dur: 0.45 });
    bell(987.77, 0.09, { dur: 0.6, gain: 0.05 });
  },
  leave: () => {
    bell(987.77, 0, { dur: 0.4, gain: 0.045 });
    bell(659.25, 0.09, { dur: 0.55, gain: 0.04 });
  },
  knock: () => {
    bell(880, 0, { dur: 0.35, gain: 0.05 });
    bell(880, 0.16, { dur: 0.45, gain: 0.05 });
  },
  message: () => bell(1318.5, 0, { dur: 0.32, gain: 0.035, ratio: 2, index: 1.2 }),
  hand: () => {
    bell(1174.66, 0, { dur: 0.35, gain: 0.04 });
    bell(1567.98, 0.07, { dur: 0.5, gain: 0.035 });
  },
  // Recording: a low, deliberate two-note chime everyone hears, so nobody is recorded unawares.
  recording: () => {
    bell(392, 0, { dur: 0.7, gain: 0.05 });
    bell(587.33, 0.18, { dur: 0.9, gain: 0.045 });
  },
  recordingStopped: () => {
    bell(587.33, 0, { dur: 0.5, gain: 0.04 });
    bell(392, 0.14, { dur: 0.7, gain: 0.04 });
  },
  admitted: () => {
    bell(523.25, 0, { dur: 0.5, gain: 0.045 });
    bell(783.99, 0.1, { dur: 0.55, gain: 0.045 });
    bell(1046.5, 0.2, { dur: 0.8, gain: 0.04 });
  },
};

export function playCue(name) {
  if (!enabled || document.hidden === undefined) return;
  try {
    CUES[name]?.();
  } catch {
    /* audio is decoration; never break the app */
  }
}
