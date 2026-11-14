import { useEffect, useRef, useState } from 'react';
import { Rosette } from './Guilloche.jsx';

/**
 * The 3D armillary sphere. Three.js is loaded only when this component appears (it is not in the
 * main bundle). Until the first frame is drawn, or if the device has no WebGL2, the engraved
 * rosette stands in, so there is never an empty hole.
 */
export default function Armillary({ getProgress, idle = false, className = '', label = 'A brass armillary sphere, turning slowly' }) {
  const ref = useRef(null);
  const [state, setState] = useState('loading'); // loading | ready | fallback
  const progressRef = useRef(getProgress);
  progressRef.current = getProgress;

  useEffect(() => {
    let scene;
    let cancelled = false;
    import('./armillaryScene.js')
      .then(({ createArmillary }) => {
        if (cancelled || !ref.current) return;
        scene = createArmillary(ref.current, {
          getProgress: progressRef.current ? () => progressRef.current() : undefined,
          idle,
          isDay: () => !ref.current?.closest('.dark'),
          onFirstFrame: () => !cancelled && setState('ready'),
        });
      })
      .catch((err) => {
        console.warn('[armillary] 3D unavailable, showing the engraving instead', err);
        if (!cancelled) setState('fallback');
      });
    return () => {
      cancelled = true;
      scene?.dispose();
    };
  }, [idle]);

  return (
    <div className={`relative ${className}`} role="img" aria-label={label}>
      {state !== 'ready' && (
        <div className="absolute inset-0 flex items-center justify-center" aria-hidden="true">
          <Rosette size={420} dense className={`max-h-[70%] max-w-[70%] opacity-40 ${state === 'loading' ? 'animate-pulse' : ''}`} />
        </div>
      )}
      <canvas ref={ref} className={`absolute inset-0 h-full w-full transition-opacity duration-[1600ms] ${state === 'ready' ? 'opacity-100' : 'opacity-0'}`} data-testid="armillary" />
    </div>
  );
}
