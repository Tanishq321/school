import { useRef } from 'react';
import { BRAND } from '../../brand.js';
import { Monogram } from '../ui/index.jsx';
import { Rosette } from './Guilloche.jsx';

const TITLE = { teacher: 'Faculty', student: 'Scholar', admin: 'Steward' };

/**
 * The membership card: anodised metal, engraved guilloché, foil lettering. It tilts toward the
 * pointer and a band of light travels across it, the way a real card catches a lamp.
 */
export default function MemberCard({ user, className = '' }) {
  const ref = useRef(null);
  const move = (e) => {
    const el = ref.current;
    const r = el.getBoundingClientRect();
    const x = (e.clientX - r.left) / r.width;
    const y = (e.clientY - r.top) / r.height;
    el.style.setProperty('--rx', `${(0.5 - y) * 9}deg`);
    el.style.setProperty('--ry', `${(x - 0.5) * 12}deg`);
    el.style.setProperty('--lx', `${x * 100}%`);
    el.style.setProperty('--ly', `${y * 100}%`);
  };
  const rest = () => {
    const el = ref.current;
    el.style.setProperty('--rx', '0deg');
    el.style.setProperty('--ry', '0deg');
  };
  const serial = (user.id || '').slice(-8).toUpperCase().replace(/(.{4})/, '$1 ');
  const since = new Date(user.createdAt || Date.now()).getFullYear();
  return (
    <div className={`[perspective:1200px] ${className}`}>
      <div
        ref={ref}
        onPointerMove={move}
        onPointerLeave={rest}
        className="member-card dark relative aspect-[1.586] w-full overflow-hidden rounded-[20px] text-vellum select-none"
        data-testid="member-card"
      >
        <Rosette size={520} dense className="pointer-events-none absolute -top-[42%] -right-[28%] opacity-[0.34]" />
        <Rosette size={260} className="pointer-events-none absolute -bottom-[38%] -left-[14%] opacity-[0.16]" />
        <div className="member-card-light pointer-events-none absolute inset-0" />
        <div className="relative flex h-full flex-col p-[7%]">
          <div className="flex items-start justify-between">
            <div className="flex items-center gap-2.5">
              <Monogram size={34} />
              <span className="font-display text-[1.35rem] tracking-tight">{BRAND.name}</span>
            </div>
            <span className="foil text-[10px] font-semibold tracking-[0.34em] uppercase">{TITLE[user.role] || 'Member'}</span>
          </div>
          <div className="mt-auto">
            <p className="font-mono text-[11px] tracking-[0.3em] text-vellum/45">Nº {serial}</p>
            <p className="foil mt-2 font-display text-[clamp(1.4rem,4.2vw,2rem)] leading-none">{user.name}</p>
            <div className="mt-3 flex items-end justify-between text-[10px] tracking-[0.26em] text-vellum/50 uppercase">
              <span>Member since {since}</span>
              <span>{user.twoFactor?.enabled ? 'Two-step secured' : 'Private'}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
