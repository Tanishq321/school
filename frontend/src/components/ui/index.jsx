import { useEffect, useId, useRef } from 'react';
import { AlertCircle, CheckCircle2, Info, Loader2, X } from 'lucide-react';

const BTN = {
  primary: 'bg-brand-600 text-white hover:bg-brand-700 shadow-sm shadow-brand-900/10',
  secondary: 'border border-line bg-white text-ink hover:bg-paper-2 dark:border-night-line dark:bg-night-3 dark:text-stone-100 dark:hover:bg-night-line',
  ghost: 'text-ink-2 hover:bg-paper-2 hover:text-ink dark:text-stone-300 dark:hover:bg-night-3 dark:hover:text-white',
  danger: 'bg-danger text-white hover:bg-danger-600',
};

export function Button({ variant = 'primary', size = 'md', loading, className = '', children, disabled, ...props }) {
  const sz = size === 'lg' ? 'h-12 px-6 text-[15px]' : size === 'sm' ? 'h-8 px-3 text-sm' : 'h-10 px-4 text-sm';
  return (
    <button
      className={`inline-flex items-center justify-center gap-2 rounded-xl font-semibold transition active:scale-[.98] disabled:pointer-events-none disabled:opacity-50 ${sz} ${BTN[variant]} ${className}`}
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
        <p id={`${id}-msg`} className={`mt-1.5 text-xs ${error ? 'text-danger' : 'text-ink-2 dark:text-stone-400'}`}>
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
        {description && <span className="block text-xs text-ink-2 dark:text-stone-400">{description}</span>}
      </span>
      <span className="relative mt-0.5 inline-flex shrink-0">
        <input type="checkbox" className="peer sr-only" checked={checked} onChange={(e) => onChange(e.target.checked)} />
        <span className="h-6 w-11 rounded-full bg-stone-300 transition peer-checked:bg-brand-600 peer-focus-visible:ring-2 peer-focus-visible:ring-brand-500 dark:bg-night-line" />
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

export function FullPageSpinner({ label = 'Loading…' }) {
  return (
    <div className="flex h-full min-h-[50vh] flex-col items-center justify-center gap-3 text-ink-2 dark:text-stone-400">
      <Spinner size={28} />
      <span className="text-sm">{label}</span>
    </div>
  );
}

export function Logo({ className = '' }) {
  return (
    <span className={`inline-flex items-center gap-2 ${className}`}>
      <svg viewBox="0 0 32 32" className="size-8" aria-hidden="true">
        <rect width="32" height="32" rx="9" fill="#0f766e" />
        <path d="M9 10h9a3 3 0 0 1 3 3v6a3 3 0 0 1-3 3H9a1 1 0 0 1-1-1V11a1 1 0 0 1 1-1z" fill="#f5f1e8" />
        <path d="M21 14.5l4-2.5v8l-4-2.5z" fill="#f5b942" />
      </svg>
      <span className="font-display text-xl font-semibold tracking-tight">{import.meta.env.VITE_APP_NAME || 'Kaksha'}</span>
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
        className={`animate-fade-up max-h-[92vh] w-full overflow-y-auto rounded-t-2xl border border-line bg-white p-5 shadow-2xl sm:rounded-2xl dark:border-night-line dark:bg-night-2 ${wide ? 'sm:max-w-2xl' : 'sm:max-w-md'}`}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="font-display text-xl font-semibold">{title}</h2>
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
      className={`inline-flex shrink-0 items-center justify-center rounded-full font-semibold text-white ${className}`}
      style={{ width: size, height: size, fontSize: size * 0.38, background: `oklch(0.55 0.09 ${hue})` }}
      aria-hidden="true"
    >
      {initials || '?'}
    </span>
  );
}
