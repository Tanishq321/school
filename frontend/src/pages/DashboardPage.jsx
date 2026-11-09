import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { CalendarPlus, Copy, KeyRound, Lock, LogIn, MailWarning, Radio, Trash2, Users, Video } from 'lucide-react';
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
      navigate(`/m/${meeting.code}`);
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
    <div className="space-y-10">
      {needsVerification && <VerifyBanner />}

      <section className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
        <div className="card relative overflow-hidden p-6 sm:p-8">
          <div className="pointer-events-none absolute -top-16 -right-16 size-56 rounded-full bg-brand-500/10 blur-2xl" />
          <p className="text-sm font-medium text-brand-600 dark:text-brand-400">{new Date().toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' })}</p>
          <h1 className="mt-1 font-display text-3xl font-semibold tracking-tight sm:text-4xl">
            {greeting}, {user.name.split(' ')[0]}
          </h1>
          <p className="mt-2 max-w-md text-ink-2 dark:text-stone-400">
            {isHostRole ? 'Start a class now, or schedule one and share the link with your students.' : 'Enter the code or link your teacher shared to join a class.'}
          </p>
          {isHostRole && (
            <div className="mt-6 flex flex-wrap gap-3">
              <Button size="lg" onClick={startInstant} loading={creating} disabled={needsVerification}>
                <Video size={18} /> New meeting
              </Button>
              <Button size="lg" variant="secondary" onClick={() => setScheduleOpen(true)} disabled={needsVerification}>
                <CalendarPlus size={18} /> Schedule class
              </Button>
            </div>
          )}
        </div>

        <form onSubmit={joinByCode} className="card flex flex-col justify-center gap-3 p-6 sm:p-8">
          <h2 className="font-display text-xl font-semibold">Join a class</h2>
          <Field
            placeholder="abc-defg-hij or invite link"
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
          <Button type="submit" disabled={!code.trim() || needsVerification}>
            <LogIn size={17} /> Join
          </Button>
        </form>
      </section>

      <section>
        <div className="mb-4 flex items-end justify-between">
          <h2 className="font-display text-2xl font-semibold">Upcoming</h2>
        </div>
        {upcoming.loading ? (
          <Spinner />
        ) : upcoming.error ? (
          <Alert>{upcoming.error}</Alert>
        ) : upcoming.meetings.length === 0 ? (
          <Empty text={isHostRole ? 'No classes scheduled. Start or schedule one above.' : 'Classes you join will appear here.'} />
        ) : (
          <ul className="grid gap-3 md:grid-cols-2">
            {upcoming.meetings.map((m) => (
              <MeetingCard key={m.code} meeting={m} onChanged={upcoming.reload} />
            ))}
          </ul>
        )}
      </section>

      <section>
        <h2 className="mb-4 font-display text-2xl font-semibold">Recent</h2>
        {past.loading ? (
          <Spinner />
        ) : past.meetings.length === 0 ? (
          <Empty text="Finished classes will appear here." />
        ) : (
          <div className="card divide-y divide-line overflow-hidden dark:divide-night-line">
            {past.meetings.slice(0, 15).map((m) => (
              <div key={m.code} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-5 py-3.5">
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">{m.title}</p>
                  <p className="text-xs text-ink-2 dark:text-stone-400">
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
          copyText(m.inviteUrl).then((ok) => toast(ok ? 'Class scheduled. Invite link copied.' : 'Class scheduled.', { tone: 'success' }));
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

const Empty = ({ text }) => <div className="rounded-2xl border border-dashed border-line px-6 py-10 text-center text-sm text-ink-2 dark:border-night-line dark:text-stone-400">{text}</div>;

export function StatusBadge({ status }) {
  const map = {
    live: 'bg-danger/10 text-danger',
    scheduled: 'bg-brand-600/10 text-brand-700 dark:text-brand-100',
    ended: 'bg-stone-500/10 text-ink-2 dark:text-stone-300',
    cancelled: 'bg-stone-500/10 text-ink-2 dark:text-stone-400',
    expired: 'bg-stone-500/10 text-ink-2 dark:text-stone-400',
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
    <li className="card flex flex-col gap-4 p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-lg font-semibold">{m.title}</p>
          <p className="text-sm text-ink-2 dark:text-stone-400">
            {fmtDateTime(m.scheduledStart)} · {m.durationMinutes} min
          </p>
        </div>
        <StatusBadge status={m.status} />
      </div>
      <div className="flex flex-wrap items-center gap-2 text-xs text-ink-2 dark:text-stone-400">
        <span className="rounded-lg bg-paper-2 px-2 py-1 font-mono dark:bg-night-3">{m.code}</span>
        {m.settings?.hasPassword && (
          <span className="inline-flex items-center gap-1">
            <KeyRound size={13} /> Password
          </span>
        )}
        {m.settings?.waitingRoom && (
          <span className="inline-flex items-center gap-1">
            <Lock size={13} /> Waiting room
          </span>
        )}
        {m.status === 'live' && m.liveParticipants > 0 && (
          <span className="inline-flex items-center gap-1">
            <Users size={13} /> {m.liveParticipants} in class
          </span>
        )}
      </div>
      <div className="mt-auto flex flex-wrap gap-2">
        <Button size="sm" onClick={() => navigate(`/m/${m.code}`)}>
          <Video size={15} /> {m.isHost ? (m.status === 'live' ? 'Rejoin' : 'Start') : 'Join'}
        </Button>
        {m.isHost && (
          <>
            <Button size="sm" variant="secondary" onClick={() => copyText(m.inviteUrl).then((ok) => toast(ok ? 'Invite link copied' : m.inviteUrl))}>
              <Copy size={15} /> Copy invite
            </Button>
            {m.status !== 'live' && (
              <Button size="sm" variant="ghost" onClick={cancel} loading={busy} aria-label="Cancel class">
                <Trash2 size={15} />
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
        <Field label="Title" placeholder="e.g. Grade 10 Maths: Quadratics" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} maxLength={120} />
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
          <table className="w-full text-left text-sm">
            <thead className="text-xs tracking-wide text-ink-2 uppercase dark:text-stone-400">
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
