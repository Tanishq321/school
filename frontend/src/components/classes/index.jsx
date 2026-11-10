import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { CalendarPlus, Copy, KeyRound, Lock, Mail, Radio, Trash2, Users, X } from 'lucide-react';
import { useToast } from '../../contexts/ToastContext.jsx';
import { api, API_BASE, getAccessToken, freshAccessToken } from '../../services/api.js';
import { Alert, Button, Field, Modal, Toggle } from '../ui/index.jsx';
import { copyText, toLocalInput } from '../../utils/format.js';

export function useMeetings(scope, { from, to } = {}) {
  const [state, setState] = useState({ loading: true, meetings: [] });
  const key = scope === 'range' ? `${from?.toISOString()}|${to?.toISOString()}` : scope;
  const load = useCallback(() => {
    setState((s) => ({ ...s, loading: true }));
    const q = scope === 'range' ? `scope=range&from=${encodeURIComponent(from.toISOString())}&to=${encodeURIComponent(to.toISOString())}` : `scope=${scope}`;
    api(`/meetings?${q}`)
      .then(({ meetings }) => setState({ loading: false, meetings }))
      .catch((err) => setState({ loading: false, meetings: [], error: err.message }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  useEffect(load, [load]);
  return { ...state, reload: load };
}

/** Download a file from an authenticated endpoint (e.g. the .ics) without exposing the token in a URL. */
export async function downloadAuthed(path, filename) {
  await freshAccessToken().catch(() => null);
  const res = await fetch(`${API_BASE}${path}`, { credentials: 'include', headers: { Authorization: `Bearer ${getAccessToken()}` } });
  if (!res.ok) throw new Error('Download failed');
  const url = URL.createObjectURL(await res.blob());
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Absolute URL for a signed media path returned by the API ("/api/..."). */
export const mediaSrc = (path) => (path ? `${API_BASE.replace(/\/api$/, '')}${path}` : undefined);

export function StatusBadge({ status }) {
  const map = {
    live: 'bg-danger/10 text-danger dark:text-red-300',
    scheduled: 'bg-brand-400/15 text-brand-700 dark:text-brand-300',
    ended: 'bg-slate-500/10 text-ink-2 dark:text-slate-300',
    cancelled: 'bg-slate-500/10 text-ink-2 dark:text-slate-400',
    expired: 'bg-slate-500/10 text-ink-2 dark:text-slate-400',
  };
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold capitalize ${map[status]}`}>
      {status === 'live' && <Radio size={12} className="animate-pulse" />}
      {status}
    </span>
  );
}

export function AgendaRow({ meeting: m, onChanged }) {
  const navigate = useNavigate();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const start = new Date(m.scheduledStart);
  const today = start.toDateString() === new Date().toDateString();
  const closed = ['ended', 'expired', 'cancelled'].includes(m.status);
  const cancel = async () => {
    if (!window.confirm(`Cancel “${m.title}”? People with the link won't be able to join.`)) return;
    setBusy(true);
    try {
      await api(`/meetings/${m.code}`, { method: 'DELETE' });
      toast('Class cancelled');
      onChanged();
    } catch (err) {
      toast(err.message, { tone: 'error' });
      setBusy(false);
    }
  };
  return (
    <li className="grid grid-cols-[5.5rem_1fr] items-center gap-x-6 gap-y-3 py-6 sm:grid-cols-[7rem_1fr_auto]">
      <div className="leading-none">
        <p className="font-display text-[1.9rem] font-normal tabular-nums">{start.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }).replace(/\s?[AP]M$/i, '')}</p>
        <p className="mt-1.5 text-xs text-ink-2 dark:text-slate-400">
          {start.toLocaleTimeString(undefined, { hour: 'numeric' }).match(/[AP]M/i)?.[0]} {today ? 'today' : start.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}
        </p>
      </div>
      <div className="min-w-0">
        <div className="flex items-center gap-3">
          <Link to={`/classes/${m.code}`} className="truncate text-lg font-medium decoration-brand-400/60 underline-offset-4 hover:underline">
            {m.title}
          </Link>
          {m.status === 'live' && <StatusBadge status="live" />}
          {m.invited && <span className="rounded-full border border-brand-400/40 px-2 py-0.5 text-[11px] tracking-wide text-brand-600 dark:text-brand-300">Guest</span>}
        </div>
        <p className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-[13px] text-ink-2 dark:text-slate-400">
          <span>{m.durationMinutes} minutes</span>
          <span className="tracking-[0.08em] tabular-nums">{m.code}</span>
          {m.settings?.hasPassword && (
            <span className="inline-flex items-center gap-1">
              <KeyRound size={13} strokeWidth={1.6} /> Password
            </span>
          )}
          {m.settings?.waitingRoom && (
            <span className="inline-flex items-center gap-1">
              <Lock size={13} strokeWidth={1.6} /> Waiting room
            </span>
          )}
          {m.status === 'live' && m.liveParticipants > 0 && (
            <span className="inline-flex items-center gap-1">
              <Users size={13} strokeWidth={1.6} /> {m.liveParticipants} in the room
            </span>
          )}
          {m.isHost && m.invitees?.length > 0 && (
            <span className="inline-flex items-center gap-1">
              <Mail size={13} strokeWidth={1.6} /> {m.invitees.length} guest{m.invitees.length > 1 ? 's' : ''}
            </span>
          )}
          {!m.isHost && m.hostName && <span>with {m.hostName}</span>}
        </p>
      </div>
      <div className="col-span-2 flex flex-wrap gap-2 sm:col-span-1 sm:justify-end">
        {closed ? (
          <Button size="sm" variant="secondary" onClick={() => navigate(`/classes/${m.code}`, { viewTransition: true })}>
            Details
          </Button>
        ) : (
          <Button size="sm" onClick={() => navigate(`/m/${m.code}`, { viewTransition: true })}>
            {m.isHost ? (m.status === 'live' ? 'Return to room' : 'Open room') : 'Join'}
          </Button>
        )}
        {m.isHost && !closed && (
          <>
            <Button size="sm" variant="secondary" onClick={() => copyText(m.inviteUrl).then((ok) => toast(ok ? 'Invitation link copied' : m.inviteUrl))}>
              <Copy size={14} strokeWidth={1.6} /> Invitation
            </Button>
            {m.status !== 'live' && (
              <Button size="sm" variant="ghost" onClick={cancel} loading={busy} aria-label="Cancel class">
                <Trash2 size={14} strokeWidth={1.6} />
              </Button>
            )}
          </>
        )}
      </div>
    </li>
  );
}

/** CSV-safe cell: quoted, and formula-looking values neutralised so spreadsheets don't execute them. */
const csvCell = (v) => {
  let s = v == null ? '' : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return `"${s.replace(/"/g, '""')}"`;
};

export function downloadAttendance(meeting, rows) {
  const header = ['Name', 'Email', 'Role', 'First joined', 'Last left', 'Minutes in class', 'Sessions'];
  const lines = rows.map((a) => [
    a.user.name,
    a.user.email,
    a.role === 'host' ? 'Host' : a.user.role,
    new Date(a.firstJoinedAt).toISOString(),
    a.present ? 'Still in class' : a.lastLeftAt ? new Date(a.lastLeftAt).toISOString() : '',
    (a.totalSeconds / 60).toFixed(1),
    a.sessions,
  ]);
  const csv = [header, ...lines].map((r) => r.map(csvCell).join(',')).join('\r\n');
  const url = URL.createObjectURL(new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = `attendance-${meeting.code}.csv`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}


/** Email "chips": type or paste addresses separated by commas, spaces or new lines. */
export function EmailChips({ value, onChange, max = 100 }) {
  const [draft, setDraft] = useState('');
  const [error, setError] = useState(null);
  const inputRef = useRef(null);
  const add = (raw) => {
    const parts = raw.split(/[\s,;]+/).map((p) => p.trim().toLowerCase()).filter(Boolean);
    if (!parts.length) return;
    const bad = parts.filter((p) => !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(p));
    const good = parts.filter((p) => !bad.includes(p) && !value.includes(p));
    if (good.length) onChange([...value, ...good].slice(0, max));
    setError(bad.length ? `Not an email address: ${bad.join(', ')}` : null);
    setDraft(bad.join(' '));
  };
  return (
    <div>
      <label className="label">Guests</label>
      <div
        className="input flex min-h-[46px] cursor-text flex-wrap items-center gap-1.5 py-1.5"
        onClick={() => inputRef.current?.focus()}
      >
        {value.map((email) => (
          <span key={email} className="inline-flex items-center gap-1.5 rounded-full border border-brand-400/30 bg-brand-400/10 py-0.5 pr-1 pl-2.5 text-[13px] text-brand-700 dark:text-brand-100">
            <Mail size={12} strokeWidth={1.6} />
            {email}
            <button type="button" className="rounded-full p-0.5 hover:bg-brand-400/20" onClick={() => onChange(value.filter((e) => e !== email))} aria-label={`Remove ${email}`}>
              <X size={12} />
            </button>
          </span>
        ))}
        <input
          ref={inputRef}
          className="min-w-[10rem] flex-1 bg-transparent py-1 outline-none"
          placeholder={value.length ? '' : 'name@school.edu, another@…'}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (['Enter', ',', ' ', 'Tab'].includes(e.key) && draft.trim()) {
              if (e.key !== 'Tab') e.preventDefault();
              add(draft);
            } else if (e.key === 'Backspace' && !draft && value.length) onChange(value.slice(0, -1));
          }}
          onPaste={(e) => {
            e.preventDefault();
            add(e.clipboardData.getData('text'));
          }}
          onBlur={() => draft.trim() && add(draft)}
          aria-label="Guest email addresses"
        />
      </div>
      <p className={`mt-1.5 text-xs ${error ? 'text-danger' : 'text-ink-2 dark:text-slate-400'}`}>
        {error || 'Guests receive an invitation with a calendar file, and are let straight in.'}
      </p>
    </div>
  );
}

/** Schedule (or reschedule) a class. `initialStart` pre-fills the date, e.g. from the calendar. */
export function ScheduleModal({ open, onClose, onSaved, initialStart, meeting }) {
  const editing = Boolean(meeting);
  const initial = () => {
    if (meeting) {
      return { title: meeting.title, start: toLocalInput(meeting.scheduledStart), duration: meeting.durationMinutes, password: '', waitingRoom: meeting.settings?.waitingRoom ?? true, invitees: meeting.invitees || [], description: meeting.description || '' };
    }
    let d = initialStart ? new Date(initialStart) : new Date(Date.now() + 60 * 60_000);
    if (!initialStart) d.setMinutes(d.getMinutes() < 30 ? 30 : 60, 0, 0);
    if (d.getTime() < Date.now()) d = new Date(Date.now() + 30 * 60_000);
    return { title: '', start: toLocalInput(d), duration: 60, password: '', waitingRoom: true, invitees: [], description: '' };
  };
  const [form, setForm] = useState(initial);
  const [state, setState] = useState({});
  useEffect(() => {
    if (open) {
      setForm(initial());
      setState({});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const submit = async (e) => {
    e.preventDefault();
    setState({ loading: true });
    try {
      const body = {
        title: form.title.trim() || 'Class',
        description: form.description.trim(),
        scheduledStart: new Date(form.start).toISOString(),
        durationMinutes: Number(form.duration),
        waitingRoom: form.waitingRoom,
        invitees: form.invitees,
        ...(form.password ? { password: form.password } : {}),
      };
      const { meeting: saved } = editing
        ? await api(`/meetings/${meeting.code}`, { method: 'PATCH', body })
        : await api('/meetings', { method: 'POST', body: { type: 'scheduled', ...body } });
      onSaved(saved);
    } catch (err) {
      setState({ error: err.message });
    }
  };

  return (
    <Modal open={open} onClose={onClose} title={editing ? 'Edit class' : 'Schedule a class'} wide>
      <form onSubmit={submit} className="space-y-5">
        {state.error && <Alert>{state.error}</Alert>}
        <Field label="Title" placeholder="e.g. Advanced Latin — Ovid, Book III" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} maxLength={120} />
        <div className="grid gap-3 sm:grid-cols-[1fr_8rem]">
          <Field label="Begins" type="datetime-local" required value={form.start} onChange={(e) => setForm({ ...form, start: e.target.value })} />
          <Field label="Minutes" type="number" min={5} max={600} step={5} required value={form.duration} onChange={(e) => setForm({ ...form, duration: e.target.value })} />
        </div>
        <EmailChips value={form.invitees} onChange={(invitees) => setForm({ ...form, invitees })} />
        <div>
          <label className="label" htmlFor="sched-desc">
            Note for guests <span className="font-normal text-ink-2/70">(optional)</span>
          </label>
          <textarea id="sched-desc" className="input min-h-[84px] resize-y" maxLength={2000} placeholder="Reading for this session, what to prepare…" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
        </div>
        <div className="grid gap-5 sm:grid-cols-2">
          <Field label={editing && meeting.settings?.hasPassword ? 'New password (optional)' : 'Password (optional)'} type="text" autoComplete="off" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} hint="Guests and invite links skip it." minLength={4} maxLength={64} />
          <div className="pt-6">
            <Toggle checked={form.waitingRoom} onChange={(v) => setForm({ ...form, waitingRoom: v })} label="Waiting room" description="Approve anyone who isn't a guest." />
          </div>
        </div>
        <div className="flex justify-end gap-2 border-t border-line/70 pt-5 dark:border-night-line">
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" loading={state.loading}>
            <CalendarPlus size={16} strokeWidth={1.6} /> {editing ? 'Save changes' : form.invitees.length ? `Schedule & invite ${form.invitees.length}` : 'Schedule'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

/** Re-renders every `ms` so countdowns stay live. */
export function useNow(ms = 1000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(t);
  }, [ms]);
  return now;
}

export function countdown(ms) {
  if (ms <= 0) return 'now';
  const m = Math.round(ms / 60000);
  if (m < 1) return 'in under a minute';
  if (m < 60) return `in ${m} minute${m === 1 ? '' : 's'}`;
  const h = Math.floor(m / 60);
  if (h < 24) return `in ${h}h ${String(m % 60).padStart(2, '0')}m`;
  const d = Math.round(h / 24);
  return `in ${d} day${d === 1 ? '' : 's'}`;
}

const fmtLen = (s) => {
  if (!s && s !== 0) return '';
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(Math.floor(s % 60)).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
};
export { fmtLen };

/** A recording as a film still: poster, running time, title. */
export function RecordingCard({ rec, className = '' }) {
  const [broken, setBroken] = useState(false);
  const ready = rec.status === 'ready';
  return (
    <Link to={`/recordings/${rec.id}`} className={`group block ${className}`} viewTransition>
      <div className="relative aspect-video overflow-hidden rounded-[18px] border border-line/80 bg-night shadow-[0_24px_50px_-30px_rgba(10,14,26,.9)] dark:border-night-line">
        {ready && rec.posterUrl && !broken ? (
          <img src={mediaSrc(rec.posterUrl)} alt="" loading="lazy" onError={() => setBroken(true)} className="h-full w-full object-cover transition duration-700 ease-out group-hover:scale-[1.035]" />
        ) : (
          <div className="lamplight flex h-full w-full items-center justify-center">
            {rec.status === 'processing' || rec.status === 'recording' ? (
              <span className="flex items-center gap-2 text-xs tracking-[0.2em] text-vellum/70 uppercase">
                <span className="size-1.5 animate-pulse rounded-full bg-brand-300" /> {rec.status === 'recording' ? 'Recording' : 'Being prepared'}
              </span>
            ) : (
              <span className="font-display text-4xl text-vellum/20 italic">{rec.status === 'failed' ? 'Unavailable' : ''}</span>
            )}
          </div>
        )}
        <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(180deg,transparent_55%,rgba(8,11,20,.75))]" />
        <div className="pointer-events-none absolute inset-0 rounded-[18px] shadow-[inset_0_0_0_1px_rgba(216,190,140,.12)]" />
        {ready && (
          <span className="absolute right-3 bottom-3 rounded-full bg-black/55 px-2 py-0.5 font-mono text-[11px] text-vellum tabular-nums backdrop-blur">{fmtLen(rec.durationSec)}</span>
        )}
        {!rec.mine && ready && <span className="absolute top-3 left-3 rounded-full bg-black/45 px-2 py-0.5 text-[11px] tracking-wide text-vellum/90 backdrop-blur">Shared with you</span>}
        {rec.mine && rec.shareWithParticipants && <span className="absolute top-3 left-3 rounded-full bg-black/45 px-2 py-0.5 text-[11px] tracking-wide text-vellum/90 backdrop-blur">Shared</span>}
      </div>
      <p className="mt-3 truncate font-display text-[19px] leading-tight">{rec.title || rec.meetingTitle || 'Class recording'}</p>
      <p className="mt-0.5 text-[13px] text-ink-2 dark:text-slate-400">
        {new Date(rec.startedAt).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'long', year: 'numeric' })}
        {rec.status === 'failed' && ' · could not be saved'}
      </p>
    </Link>
  );
}

/** Section heading in the house style: small-caps eyebrow over a serif title. */
export function SectionTitle({ eyebrow, title, action }) {
  return (
    <div className="mb-6 flex items-end justify-between gap-4">
      <div>
        {eyebrow && <p className="mb-1.5 text-[11px] font-medium tracking-[0.24em] text-brand-600 uppercase dark:text-brand-300/80">{eyebrow}</p>}
        <h2 className="font-display text-[2rem] leading-none font-normal">{title}</h2>
      </div>
      {action}
    </div>
  );
}

export const Empty = ({ children }) => <p className="border-y border-line/80 py-10 text-ink-2 dark:border-night-line dark:text-slate-400">{children}</p>;
