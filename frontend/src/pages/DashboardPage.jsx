import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { CalendarPlus, Copy, Download, KeyRound, Lock, LogIn, MailWarning, Radio, Trash2, Users, Video } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext.jsx';
import { useToast } from '../contexts/ToastContext.jsx';
import { api } from '../services/api.js';
import { Alert, Button, Field, Modal, Spinner, Toggle } from '../components/ui/index.jsx';
import { copyText, fmtDateTime, fmtDuration, toLocalInput } from '../utils/format.js';

function useMeetings(scope) {
  const [state, setState] = useState({ loading: true, meetings: [] });
  const load = useCallback(() => {
    setState((s) => ({ ...s, loading: true }));
    api(`/meetings?scope=${scope}`)
      .then(({ meetings }) => setState({ loading: false, meetings }))
      .catch((err) => setState({ loading: false, meetings: [], error: err.message }));
  }, [scope]);
  useEffect(load, [load]);
  return { ...state, reload: load };
}

export default function DashboardPage() {
  const { user, needsVerification } = useAuth();
  const navigate = useNavigate();
  const toast = useToast();
  const upcoming = useMeetings('upcoming');
  const past = useMeetings('past');
  const [code, setCode] = useState('');
  const [codeError, setCodeError] = useState(null);
  const [creating, setCreating] = useState(false);
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [attendanceFor, setAttendanceFor] = useState(null);
  const isHostRole = user.role === 'teacher' || user.role === 'admin';
  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';

  const startInstant = async () => {
    setCreating(true);
    try {
      const { meeting } = await api('/meetings', { method: 'POST', body: { type: 'instant' } });
      navigate(`/m/${meeting.code}`, { viewTransition: true });
    } catch (err) {
      toast(err.message, { tone: 'error' });
      setCreating(false);
    }
  };

  const joinByCode = (e) => {
    e.preventDefault();
    const trimmed = code.trim();
    // Accept a full invite link as well as a bare code.
    try {
      const url = new URL(trimmed);
      const m = url.pathname.match(/\/m\/([a-z-]+)/i);
      if (m) return navigate(`/m/${m[1].toLowerCase()}${url.search}`);
    } catch {
      /* not a URL */
    }
    const letters = trimmed.toLowerCase().replace(/[^a-z]/g, '');
    if (letters.length !== 10) return setCodeError('Meeting codes look like abc-defg-hij');
    navigate(`/m/${letters.slice(0, 3)}-${letters.slice(3, 7)}-${letters.slice(7)}`);
    return undefined;
  };

  return (
    <div className="space-y-14">
      {needsVerification && <VerifyBanner />}

      <section className="grid items-end gap-10 lg:grid-cols-[1.35fr_1fr]">
        <div>
          <p className="text-sm text-ink-2 dark:text-slate-400">{new Date().toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' })}</p>
          <h1 className="animate-reveal mt-3 font-display text-[3.2rem] leading-[1.02] font-normal sm:text-[4.2rem]">
            {greeting},<br />
            {user.name.split(' ')[0]}.
          </h1>
          <p className="mt-5 max-w-md text-[17px] text-ink-2 dark:text-slate-400">
            {isHostRole ? 'Open a room now, or set a time and send the invitation.' : 'Enter the code or link your teacher sent you.'}
          </p>
          {isHostRole && (
            <div className="mt-8 flex flex-wrap gap-3">
              <Button size="lg" onClick={startInstant} loading={creating} disabled={needsVerification}>
                <Video size={18} strokeWidth={1.6} /> Open a room now
              </Button>
              <Button size="lg" variant="secondary" onClick={() => setScheduleOpen(true)} disabled={needsVerification}>
                <CalendarPlus size={18} strokeWidth={1.6} /> Schedule a class
              </Button>
            </div>
          )}
        </div>

        <form onSubmit={joinByCode} className="card p-6 sm:p-7">
          <h2 className="font-display text-2xl font-normal">Join a class</h2>
          <p className="mt-1 mb-5 text-sm text-ink-2 dark:text-slate-400">Paste the invitation link or type the code.</p>
          <div className="flex gap-2">
            <Field
              className="flex-1"
              placeholder="abc-defg-hij"
              aria-label="Meeting code or link"
              value={code}
              onChange={(e) => {
                setCode(e.target.value);
                setCodeError(null);
              }}
              error={codeError}
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
            />
            <Button type="submit" disabled={!code.trim() || needsVerification} className="h-[46px]" aria-label="Join">
              <LogIn size={17} strokeWidth={1.6} />
            </Button>
          </div>
        </form>
      </section>

      <div className="hairline" />

      <section>
        <h2 className="mb-6 font-display text-3xl font-normal">Upcoming</h2>
        {upcoming.loading ? (
          <Spinner />
        ) : upcoming.error ? (
          <Alert>{upcoming.error}</Alert>
        ) : upcoming.meetings.length === 0 ? (
          <Empty text={isHostRole ? 'Nothing on the calendar. Open a room or schedule a class.' : 'Classes you join will appear here.'} />
        ) : (
          <ol className="divide-y divide-line/80 border-y border-line/80 dark:divide-night-line dark:border-night-line">
            {upcoming.meetings.map((m) => (
              <MeetingCard key={m.code} meeting={m} onChanged={upcoming.reload} />
            ))}
          </ol>
        )}
      </section>

      <section>
        <h2 className="mb-6 font-display text-3xl font-normal">Recent</h2>
        {past.loading ? (
          <Spinner />
        ) : past.meetings.length === 0 ? (
          <Empty text="Finished classes will appear here." />
        ) : (
          <div className="divide-y divide-line/80 border-y border-line/80 dark:divide-night-line dark:border-night-line">
            {past.meetings.slice(0, 15).map((m) => (
              <div key={m.code} className="flex flex-wrap items-center gap-x-4 gap-y-1 py-4">
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">{m.title}</p>
                  <p className="text-xs text-ink-2 dark:text-slate-400">
                    {fmtDateTime(m.startedAt || m.scheduledStart)}
                    {m.startedAt && m.endedAt && ` · ${fmtDuration((new Date(m.endedAt) - new Date(m.startedAt)) / 1000)}`}
                    {!m.isHost && m.hostName && ` · with ${m.hostName}`}
                  </p>
                </div>
                <StatusBadge status={m.status} />
                {m.isHost && m.startedAt && (
                  <Button variant="ghost" size="sm" onClick={() => setAttendanceFor(m)}>
                    <Users size={15} /> Attendance
                  </Button>
                )}
              </div>
            ))}
          </div>
        )}
      </section>

      <ScheduleModal
        open={scheduleOpen}
        onClose={() => setScheduleOpen(false)}
        onCreated={(m) => {
          setScheduleOpen(false);
          upcoming.reload();
          copyText(m.inviteUrl).then((ok) => toast(ok ? 'Class scheduled. Invitation link copied.' : 'Class scheduled.', { tone: 'success' }));
        }}
      />
      <AttendanceModal meeting={attendanceFor} onClose={() => setAttendanceFor(null)} />
    </div>
  );
}

function VerifyBanner() {
  const [state, setState] = useState(null);
  const resend = async () => {
    setState('sending');
    try {
      await api('/auth/resend-verification', { method: 'POST' });
      setState('sent');
    } catch (err) {
      setState(err.message);
    }
  };
  return (
    <Alert tone="info">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <span className="flex items-center gap-2">
          <MailWarning size={16} /> Verify your email to host or join classes. Check your inbox for the link.
        </span>
        {state === 'sent' ? (
          <span className="font-semibold">New link sent.</span>
        ) : (
          <button onClick={resend} disabled={state === 'sending'} className="font-semibold underline underline-offset-2">
            Resend email
          </button>
        )}
        {state && !['sent', 'sending'].includes(state) && <span>{state}</span>}
      </div>
    </Alert>
  );
}

const Empty = ({ text }) => <p className="border-y border-line/80 py-10 text-ink-2 dark:border-night-line dark:text-slate-400">{text}</p>;

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

function MeetingCard({ meeting: m, onChanged }) {
  const navigate = useNavigate();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const start = new Date(m.scheduledStart);
  const today = start.toDateString() === new Date().toDateString();
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
          <p className="truncate text-lg font-medium">{m.title}</p>
          {m.status === 'live' && <StatusBadge status="live" />}
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
          {!m.isHost && m.hostName && <span>with {m.hostName}</span>}
        </p>
      </div>
      <div className="col-span-2 flex flex-wrap gap-2 sm:col-span-1 sm:justify-end">
        <Button size="sm" onClick={() => navigate(`/m/${m.code}`, { viewTransition: true })}>
          {m.isHost ? (m.status === 'live' ? 'Return to room' : 'Open room') : 'Join'}
        </Button>
        {m.isHost && (
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

function ScheduleModal({ open, onClose, onCreated }) {
  const initial = () => {
    const d = new Date(Date.now() + 60 * 60_000);
    d.setMinutes(d.getMinutes() < 30 ? 30 : 60, 0, 0);
    return { title: '', start: toLocalInput(d), duration: 60, password: '', waitingRoom: true };
  };
  const [form, setForm] = useState(initial);
  const [state, setState] = useState({});
  useEffect(() => {
    if (open) {
      setForm(initial());
      setState({});
    }
  }, [open]);

  const submit = async (e) => {
    e.preventDefault();
    setState({ loading: true });
    try {
      const { meeting } = await api('/meetings', {
        method: 'POST',
        body: {
          type: 'scheduled',
          title: form.title.trim() || 'Class',
          scheduledStart: new Date(form.start).toISOString(),
          durationMinutes: Number(form.duration),
          waitingRoom: form.waitingRoom,
          ...(form.password ? { password: form.password } : {}),
        },
      });
      onCreated(meeting);
    } catch (err) {
      setState({ error: err.message });
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="Schedule a class">
      <form onSubmit={submit} className="space-y-4">
        {state.error && <Alert>{state.error}</Alert>}
        <Field label="Title" placeholder="e.g. Organic chemistry, session 4" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} maxLength={120} />
        <div className="grid grid-cols-[1fr_auto] gap-3">
          <Field label="Starts" type="datetime-local" required value={form.start} onChange={(e) => setForm({ ...form, start: e.target.value })} />
          <Field label="Minutes" type="number" min={5} max={600} step={5} required value={form.duration} onChange={(e) => setForm({ ...form, duration: e.target.value })} className="w-24" />
        </div>
        <Field label="Meeting password (optional)" type="text" autoComplete="off" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} hint="People using your invite link won't need it." minLength={4} maxLength={64} />
        <Toggle checked={form.waitingRoom} onChange={(v) => setForm({ ...form, waitingRoom: v })} label="Waiting room" description="You approve each student before they enter." />
        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" loading={state.loading}>
            Schedule
          </Button>
        </div>
      </form>
    </Modal>
  );
}

/** CSV-safe cell: quoted, and formula-looking values neutralised so spreadsheets don't execute them. */
const csvCell = (v) => {
  let s = v == null ? '' : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return `"${s.replace(/"/g, '""')}"`;
};

function downloadAttendance(meeting, rows) {
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

function AttendanceModal({ meeting, onClose }) {
  const [data, setData] = useState(null);
  useEffect(() => {
    if (!meeting) return;
    setData(null);
    api(`/meetings/${meeting.code}/attendance`)
      .then(setData)
      .catch((err) => setData({ error: err.message }));
  }, [meeting]);
  return (
    <Modal open={Boolean(meeting)} onClose={onClose} title={`Attendance · ${meeting?.title ?? ''}`} wide>
      {!data ? (
        <Spinner />
      ) : data.error ? (
        <Alert>{data.error}</Alert>
      ) : data.attendance.length === 0 ? (
        <p className="text-sm text-ink-2">Nobody joined this class.</p>
      ) : (
        <div className="overflow-x-auto">
          <div className="mb-4 flex justify-end">
            <Button size="sm" variant="secondary" onClick={() => downloadAttendance(meeting, data.attendance)}>
              <Download size={14} strokeWidth={1.6} /> Download CSV
            </Button>
          </div>
          <table className="w-full text-left text-sm">
            <thead className="text-xs tracking-wide text-ink-2 uppercase dark:text-slate-400">
              <tr>
                <th className="py-2 pr-4">Name</th>
                <th className="py-2 pr-4">First joined</th>
                <th className="py-2 pr-4">Left</th>
                <th className="py-2 pr-4">Time in class</th>
                <th className="py-2">Sessions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line dark:divide-night-line">
              {data.attendance.map((a) => (
                <tr key={a.user.id}>
                  <td className="py-2.5 pr-4 font-medium">
                    {a.user.name} {a.role === 'host' && <span className="ml-1 text-xs text-brand-600">host</span>}
                  </td>
                  <td className="py-2.5 pr-4">{fmtDateTime(a.firstJoinedAt)}</td>
                  <td className="py-2.5 pr-4">{a.present ? 'Still in class' : a.lastLeftAt ? fmtDateTime(a.lastLeftAt) : '—'}</td>
                  <td className="py-2.5 pr-4">{fmtDuration(a.totalSeconds)}</td>
                  <td className="py-2.5">{a.sessions}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Modal>
  );
}
