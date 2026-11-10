import { memo, useMemo } from 'react';

/**
 * Guilloché: the fine interlaced engraving found on banknotes, share certificates and watch
 * dials. Drawn mathematically (phase-shifted sinusoids wrapped round a circle), never an image,
 * so it stays razor-sharp at any size and costs a few kilobytes.
 */
function ring({ r, amp, lobes, strands, steps = 360 }) {
  const paths = [];
  for (let k = 0; k < strands; k += 1) {
    const phase = (2 * Math.PI * k) / strands;
    let d = '';
    for (let i = 0; i <= steps; i += 1) {
      const t = (2 * Math.PI * i) / steps;
      const rad = r + amp * Math.sin(lobes * t + phase);
      d += `${i ? 'L' : 'M'}${(100 + rad * Math.cos(t)).toFixed(2)} ${(100 + rad * Math.sin(t)).toFixed(2)}`;
    }
    paths.push(`${d}Z`);
  }
  return paths;
}

export const Rosette = memo(function Rosette({ size = 400, className = '', stroke = 'url(#g-brass)', strokeWidth = 0.22, dense = false }) {
  const paths = useMemo(
    () => [
      ...ring({ r: 78, amp: 17, lobes: 16, strands: dense ? 14 : 9 }),
      ...ring({ r: 52, amp: 13, lobes: 10, strands: dense ? 12 : 8 }),
      ...ring({ r: 27, amp: 9, lobes: 7, strands: 7 }),
    ],
    [dense],
  );
  return (
    <svg viewBox="0 0 200 200" width={size} height={size} className={className} aria-hidden="true" fill="none">
      <defs>
        <linearGradient id="g-brass" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#f0dcae" />
          <stop offset=".5" stopColor="#b48d55" />
          <stop offset="1" stopColor="#6e532c" />
        </linearGradient>
      </defs>
      <g stroke={stroke} strokeWidth={strokeWidth}>
        {paths.map((d, i) => (
          <path key={i} d={d} />
        ))}
        <circle cx="100" cy="100" r="96.5" strokeWidth={strokeWidth * 2} />
        <circle cx="100" cy="100" r="98.6" strokeWidth={strokeWidth} />
      </g>
    </svg>
  );
});

/** A woven band of waves, for rules and borders (the edge of a certificate). */
export const WaveBand = memo(function WaveBand({ className = '', height = 14, strands = 7, opacity = 0.7 }) {
  const paths = useMemo(() => {
    const out = [];
    for (let k = 0; k < strands; k += 1) {
      let d = '';
      for (let x = 0; x <= 240; x += 2) {
        const y = 7 + 5 * Math.sin((x / 240) * Math.PI * 12 + (2 * Math.PI * k) / strands);
        d += `${x ? 'L' : 'M'}${x} ${y.toFixed(2)}`;
      }
      out.push(d);
    }
    return out;
  }, [strands]);
  return (
    <svg className={className} height={height} width="100%" preserveAspectRatio="none" viewBox="0 0 240 14" aria-hidden="true" fill="none" style={{ opacity }}>
      <defs>
        <linearGradient id="g-band" x1="0" x2="1">
          <stop offset="0" stopColor="#b48d55" stopOpacity="0" />
          <stop offset=".2" stopColor="#d8be8c" />
          <stop offset=".8" stopColor="#b48d55" />
          <stop offset="1" stopColor="#b48d55" stopOpacity="0" />
        </linearGradient>
      </defs>
      {paths.map((d, i) => (
        <path key={i} d={d} stroke="url(#g-band)" strokeWidth=".35" vectorEffect="non-scaling-stroke" />
      ))}
    </svg>
  );
});
