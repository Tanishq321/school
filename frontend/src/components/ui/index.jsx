import { useEffect, useId, useRef } from 'react';
import { AlertCircle, CheckCircle2, Info, Loader2, X } from 'lucide-react';
import { BRAND } from '../../brand.js';

const BTN = {
  // Brushed brass: the product's one metallic accent, used for the primary action only.
  primary:
    'bg-[linear-gradient(180deg,#a8864f_0%,#86663a_100%)] text-vellum shadow-[inset_0_1px_0_rgba(255,240,210,.35),0_10px_24px_-14px_rgba(110,83,44,.9)] hover:brightness-110',
  secondary:
    'border border-line bg-white/70 text-ink hover:border-brand-400/60 hover:bg-white dark:border-night-line dark:bg-night-3/70 dark:text-vellum dark:hover:border-brand-500/50',
  ghost: 'text-ink-2 hover:bg-paper-2 hover:text-ink dark:text-slate-300 dark:hover:bg-night-3 dark:hover:text-white',
  danger: 'bg-danger text-vellum hover:bg-danger-600',
};

export function Button({ variant = 'primary', size = 'md', loading, className = '', children, disabled, ...props }) {
  const sz = size === 'lg' ? 'h-12 px-7 text-[15px]' : size === 'sm' ? 'h-8 px-3.5 text-[13px]' : 'h-10 px-5 text-sm';
  return (
    <button
      data-sheen={variant === 'primary' ? '' : undefined}
      className={`${variant === 'primary' ? 'sheen ' : ''}inline-flex items-center justify-center gap-2 rounded-full font-medium tracking-[0.01em] transition duration-200 active:scale-[.98] disabled:pointer-events-none disabled:opacity-50 ${sz} ${BTN[variant]} ${className}`}
      disabled={disabled || loading}
      {...props}
    >
      {loading && <Loader2 size={16} className="animate-spin" />}
      {children}
    </button>
  );
}

export function Field({ label, error, hint, className = '', ...props }) {
  const id = useId();
  return (
    <div className={className}>
      {label && (
        <label htmlFor={id} className="label">
          {label}
        </label>
      )}
      <input id={id} className="input" aria-invalid={Boolean(error)} aria-describedby={error || hint ? `${id}-msg` : undefined} {...props} />
      {(error || hint) && (
        <p id={`${id}-msg`} className={`mt-1.5 text-xs ${error ? 'text-danger' : 'text-ink-2 dark:text-slate-400'}`}>
          {error || hint}
        </p>
      )}
    </div>
  );
}

export function Select({ label, options, className = '', ...props }) {
  const id = useId();
  return (
    <div className={className}>
      {label && (
        <label htmlFor={id} className="label">
          {label}
        </label>
      )}
      <select id={id} className="input appearance-none pr-8" {...props}>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  );
}

export function Toggle({ checked, onChange, label, description }) {
  return (
    <label className="flex cursor-pointer items-start justify-between gap-4">
      <span>
        <span className="block text-sm font-medium">{label}</span>
        {description && <span className="block text-xs text-ink-2 dark:text-slate-400">{description}</span>}
      </span>
      <span className="relative mt-0.5 inline-flex shrink-0">
        <input type="checkbox" className="peer sr-only" checked={checked} onChange={(e) => onChange(e.target.checked)} />
        <span className="h-6 w-11 rounded-full bg-line transition peer-checked:bg-brand-500 peer-focus-visible:ring-2 peer-focus-visible:ring-brand-400 dark:bg-night-line dark:peer-checked:bg-brand-500" />
        <span className="absolute top-0.5 left-0.5 size-5 rounded-full bg-white shadow transition peer-checked:translate-x-5" />
      </span>
    </label>
  );
}

export function Alert({ tone = 'error', children, className = '' }) {
  const Icon = tone === 'error' ? AlertCircle : tone === 'success' ? CheckCircle2 : Info;
  const cls =
    tone === 'error'
      ? 'border-danger/30 bg-danger/8 text-danger-600 dark:text-red-300'
      : tone === 'success'
        ? 'border-brand-500/30 bg-brand-50 text-brand-700 dark:bg-brand-700/15 dark:text-brand-100'
        : 'border-saffron/40 bg-saffron/10 text-amber-800 dark:text-amber-200';
  return (
    <div role={tone === 'error' ? 'alert' : 'status'} className={`flex items-start gap-2.5 rounded-xl border px-3.5 py-2.5 text-sm ${cls} ${className}`}>
      <Icon size={17} className="mt-0.5 shrink-0" />
      <div className="min-w-0">{children}</div>
    </div>
  );
}

export const Spinner = ({ size = 20, className = '' }) => <Loader2 size={size} className={`animate-spin ${className}`} aria-label="Loading" />;

/** The monogram with a brass arc travelling around it: the house loading mark. */
export function FullPageSpinner({ label = 'One moment' }) {
  return (
    <div className="flex h-full min-h-[50vh] flex-col items-center justify-center gap-5 text-ink-2 dark:text-slate-400" role="status">
      <span className="relative inline-flex">
        <Monogram size={46} />
        <svg viewBox="0 0 50 50" className="absolute -inset-[7px] h-[60px] w-[60px] animate-spin [animation-duration:1.6s]" aria-hidden="true">
          <circle cx="25" cy="25" r="23" fill="none" stroke="var(--color-brand-400)" strokeWidth="1" strokeLinecap="round" strokeDasharray="28 120" />
        </svg>
      </span>
      <span className="text-sm tracking-wide">{label}</span>
    </div>
  );
}

/** Monogram: a Bodoni initial set in an engraved brass ring. */
export function Monogram({ size = 34, className = '' }) {
  return (
    <svg viewBox="0 0 40 40" width={size} height={size} className={className} aria-hidden="true">
      <defs>
        <linearGradient id="brass" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#e6cf9f" />
          <stop offset=".5" stopColor="#b48d55" />
          <stop offset="1" stopColor="#7a5c31" />
        </linearGradient>
      </defs>
      <circle cx="20" cy="20" r="18.5" fill="none" stroke="url(#brass)" strokeWidth="1.1" />
      <circle cx="20" cy="20" r="15.6" fill="none" stroke="url(#brass)" strokeWidth=".4" opacity=".7" />
      <text x="20" y="27.2" textAnchor="middle" fontFamily="Bodoni Moda Variable, Didot, serif" fontSize="21" fontWeight="500" fill="url(#brass)">
        {BRAND.letter}
      </text>
    </svg>
  );
}

export function Logo({ className = '' }) {
  return (
    <span className={`inline-flex items-center gap-2.5 ${className}`}>
      <Monogram />
      <span className="font-display text-[22px] font-medium tracking-tight">{BRAND.name}</span>
    </span>
  );
}

export function Modal({ open, onClose, title, children, wide }) {
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const prev = document.activeElement;
    ref.current?.querySelector('input,select,button,textarea')?.focus();
    const onKey = (e) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      prev?.focus?.();
    };
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-0 backdrop-blur-sm sm:items-center sm:p-4" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={`animate-fade-up max-h-[92vh] w-full overflow-y-auto rounded-t-[26px] border border-line bg-paper p-6 shadow-2xl sm:rounded-[26px] dark:border-night-line dark:bg-night-2 ${wide ? 'sm:max-w-2xl' : 'sm:max-w-md'}`}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="font-display text-2xl font-medium">{title}</h2>
          <button onClick={onClose} className="rounded-lg p-1.5 text-ink-2 hover:bg-paper-2 dark:hover:bg-night-3" aria-label="Close">
            <X size={18} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function Avatar({ name = '?', size = 40, className = '' }) {
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0].toUpperCase())
    .join('');
  const hue = [...name].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 360, 7);
  return (
    <span
      className={`inline-flex shrink-0 items-center justify-center rounded-full font-display font-medium text-vellum ${className}`}
      style={{ width: size, height: size, fontSize: size * 0.36, background: `linear-gradient(145deg, oklch(0.48 0.06 ${hue}), oklch(0.32 0.05 ${hue}))`, boxShadow: 'inset 0 0 0 1px rgba(216,190,140,.35)' }}
      aria-hidden="true"
    >
      {initials || '?'}
    </span>
  );
}
