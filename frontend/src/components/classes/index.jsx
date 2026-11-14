import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { BookOpenCheck, CalendarPlus, Copy, KeyRound, Lock, Mail, Radio, Repeat, Trash2, Users } from 'lucide-react';
import { useToast } from '../../contexts/ToastContext.jsx';
import { api, API_BASE, getAccessToken, freshAccessToken } from '../../services/api.js';
import { Alert, Button, Field, Modal, Select, Toggle } from '../ui/index.jsx';
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
  const [cancelling, setCancelling] = useState(false);
  const start = new Date(m.scheduledStart);
  const today = start.toDateString() === new Date().toDateString();
  const closed = ['ended', 'expired', 'cancelled'].includes(m.status);
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
          {m.invited && <span className="rounded-full border border-brand-400/40 px-2 py-0.5 text-[11px] tracking-wide text-brand-600 dark:text-brand-300">Your class</span>}
          {m.seriesId && (
            <span className="inline-flex shrink-0 items-center gap-1 text-[11px] tracking-wide text-ink-2 dark:text-slate-400" title="Part of a weekly series">
              <Repeat size={12} strokeWidth={1.6} /> Weekly
            </span>
          )}
          {m.homeworkOpen > 0 && (
            <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-brand-400/12 px-2 py-0.5 text-[11px] tracking-wide text-brand-700 dark:text-brand-300">
              <BookOpenCheck size={12} strokeWidth={1.6} /> {m.homeworkOpen} to do
            </span>
          )}
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
          {m.isHost && m.invitees?.[0] && (
            <span className="inline-flex items-center gap-1">
              <Mail size={13} strokeWidth={1.6} /> {m.invitees[0]}
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
              <Button size="sm" variant="ghost" onClick={() => setCancelling(true)} aria-label="Cancel class">
                <Trash2 size={14} strokeWidth={1.6} />
              </Button>
            )}
          </>
        )}
      </div>
      {m.isHost && <CancelClassModal meeting={m} open={cancelling} onClose={() => setCancelling(false)} onDone={onChanged} />}
    </li>
  );
}

/**
 * Cancel a class. A lesson in a weekly series can be cancelled alone, or with every later lesson.
 * The student is told by email, with a calendar file that removes the lessons.
 */
export function CancelClassModal({ meeting: m, open, onClose, onDone }) {
  const toast = useToast();
  const [busy, setBusy] = useState(null);
  const cancel = async (scope) => {
    setBusy(scope);
    try {
      const { cancelled } = await api(`/meetings/${m.code}?scope=${scope}`, { method: 'DELETE' });
      toast(cancelled > 1 ? `${cancelled} lessons cancelled${m.invitees?.[0] ? '. Your student has been told.' : '.'}` : `Class cancelled${m.invitees?.[0] ? '. Your student has been told.' : '.'}`, { tone: 'success' });
      onClose();
      onDone?.();
    } catch (err) {
      toast(err.message, { tone: 'error' });
    } finally {
      setBusy(null);
    }
  };
  return (
    <Modal open={open} onClose={onClose} title={m.seriesId ? 'Cancel a lesson in a series' : 'Cancel this class'}>
      <p className="text-ink-2 dark:text-slate-400">
        <span className="font-medium text-ink dark:text-vellum">{m.title}</span>,{' '}
        {new Date(m.scheduledStart).toLocaleString(undefined, { weekday: 'long', day: 'numeric', month: 'long', hour: 'numeric', minute: '2-digit' })}.
        {m.invitees?.[0] ? ` ${m.invitees[0]} receives an email, and the lesson leaves their calendar.` : ' Nobody with the link will be able to join.'}
      </p>
      <div className="mt-7 flex flex-col gap-2 sm:flex-row sm:justify-end">
        <Button variant="ghost" onClick={onClose}>
          Keep it
        </Button>
        {m.seriesId && (
          <Button variant="secondary" onClick={() => cancel('following')} loading={busy === 'following'} disabled={Boolean(busy)}>
            This and following lessons
          </Button>
        )}
        <Button variant="danger" onClick={() => cancel('one')} loading={busy === 'one'} disabled={Boolean(busy)}>
          {m.seriesId ? 'This lesson only' : 'Cancel the class'}
        </Button>
      </div>
    </Modal>
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


/** Schedule (or reschedule) a class. `initialStart` pre-fills the date, e.g. from the calendar. */
const REPEAT = [
  { value: '1', label: 'Does not repeat' },
  { value: '4', label: 'Weekly, 4 lessons' },
  { value: '6', label: 'Weekly, 6 lessons' },
  { value: '8', label: 'Weekly, 8 lessons' },
  { value: '10', label: 'Weekly, 10 lessons' },
  { value: '12', label: 'Weekly, a term (12)' },
  { value: '26', label: 'Weekly, half a year (26)' },
];

export function ScheduleModal({ open, onClose, onSaved, initialStart, initialInvitee, meeting }) {
  const editing = Boolean(meeting);
  const initial = () => {
    if (meeting) {
      return { title: meeting.title, start: toLocalInput(meeting.scheduledStart), duration: meeting.durationMinutes, password: '', waitingRoom: meeting.settings?.waitingRoom ?? true, invitees: meeting.invitees || [], description: meeting.description || '' };
    }
    let d = initialStart ? new Date(initialStart) : new Date(Date.now() + 60 * 60_000);
    if (!initialStart) d.setMinutes(d.getMinutes() < 30 ? 30 : 60, 0, 0);
    if (d.getTime() < Date.now()) d = new Date(Date.now() + 30 * 60_000);
    return { title: '', start: toLocalInput(d), duration: 60, password: '', waitingRoom: true, invitees: initialInvitee ? [initialInvitee] : [], description: '', repeat: '1' };
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
      const { meeting: saved, series } = editing
        ? await api(`/meetings/${meeting.code}`, { method: 'PATCH', body })
        : await api('/meetings', { method: 'POST', body: { type: 'scheduled', ...body, ...(Number(form.repeat) > 1 ? { repeatWeeks: Number(form.repeat) } : {}) } });
      onSaved(saved, series);
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
        {!editing && (
          <div>
            <Select label="Repeat" options={REPEAT} value={form.repeat} onChange={(e) => setForm({ ...form, repeat: e.target.value })} data-testid="repeat" />
            {Number(form.repeat) > 1 && (
              <p className="mt-1.5 text-xs text-ink-2 dark:text-slate-400">
                Every {new Date(form.start).toLocaleDateString(undefined, { weekday: 'long' })} at this time, until{' '}
                {new Date(new Date(form.start).getTime() + (Number(form.repeat) - 1) * 7 * 86_400_000).toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' })}. Each lesson can be moved or cancelled on its own.
              </p>
            )}
          </div>
        )}
        {editing && meeting.seriesId && <p className="text-xs text-ink-2 dark:text-slate-400">This changes this lesson only; the rest of the series keeps its times.</p>}
        <Field
          label="Student’s email"
          type="email"
          placeholder="student@example.com"
          autoComplete="off"
          value={form.invitees[0] || ''}
          onChange={(e) => setForm({ ...form, invitees: e.target.value.trim() ? [e.target.value.trim().toLowerCase()] : [] })}
          hint="Optional. Classes are one-to-one: your student gets an invitation with a calendar file and is let straight in."
        />
        <div>
          <label className="label" htmlFor="sched-desc">
            Note for your student <span className="font-normal text-ink-2/70">(optional)</span>
          </label>
          <textarea id="sched-desc" className="input min-h-[84px] resize-y" maxLength={2000} placeholder="Reading for this session, what to prepare…" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
        </div>
        <div className="grid gap-5 sm:grid-cols-2">
          <Field label={editing && meeting.settings?.hasPassword ? 'New password (optional)' : 'Password (optional)'} type="text" autoComplete="off" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} hint="Guests and invite links skip it." minLength={4} maxLength={64} />
          <div className="pt-6">
            <Toggle checked={form.waitingRoom} onChange={(v) => setForm({ ...form, waitingRoom: v })} label="Waiting room" description="Approve anyone who isn't your invited student." />
          </div>
        </div>
        <div className="flex justify-end gap-2 border-t border-line/70 pt-5 dark:border-night-line">
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" loading={state.loading}>
            <CalendarPlus size={16} strokeWidth={1.6} /> {editing ? 'Save changes' : Number(form.repeat) > 1 ? `Schedule ${form.repeat} lessons` : form.invitees.length ? 'Schedule & invite' : 'Schedule'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

/** The confirmation after scheduling: one class or a series, invited or not. */
export function scheduledMessage(m, series, copied) {
  const what = series?.count > 1 ? `${series.count} weekly lessons scheduled` : 'Scheduled';
  if (m.invitees?.length) return `${what}. ${series?.count > 1 ? 'One invitation with every date' : 'Invitation'} sent to ${m.invitees[0]}.`;
  return copied ? `${what}. Invitation link copied.` : `${what}.`;
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
      <div className="relative aspect-video overflow-hidden rounded-[18px] border border-line/80 bg-paper-2 shadow-[0_24px_50px_-30px_rgba(60,46,24,.5)] dark:border-night-line dark:bg-night dark:shadow-[0_24px_50px_-30px_rgba(10,14,26,.9)]">
        {ready && rec.posterUrl && !broken ? (
          <img src={mediaSrc(rec.posterUrl)} alt="" loading="lazy" onError={() => setBroken(true)} className="h-full w-full object-cover transition duration-700 ease-out group-hover:scale-[1.035]" />
        ) : (
          <div className="lamplight flex h-full w-full items-center justify-center">
            {rec.status === 'processing' || rec.status === 'recording' ? (
              <span className="flex items-center gap-2 text-xs tracking-[0.2em] text-hi/70 uppercase">
                <span className="size-1.5 animate-pulse rounded-full bg-brass" /> {rec.status === 'recording' ? 'Recording' : 'Being prepared'}
              </span>
            ) : (
              <span className="font-display text-4xl text-hi/25 italic">{rec.status === 'failed' ? 'Unavailable' : ''}</span>
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
