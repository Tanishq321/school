import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowRight, CalendarPlus, CalendarRange, Copy, LogIn, MailWarning, Radio, Users, Video } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext.jsx';
import { useToast } from '../contexts/ToastContext.jsx';
import { api } from '../services/api.js';
import { Alert, Button, Field, Spinner } from '../components/ui/index.jsx';
import { Rosette } from '../components/brand/Guilloche.jsx';
import { AgendaRow, countdown, downloadAuthed, Empty, RecordingCard, ScheduleModal, SectionTitle, useMeetings, useNow } from '../components/classes/index.jsx';
import { copyText, fmtTime } from '../utils/format.js';

export default function TodayPage() {
  const { user, needsVerification } = useAuth();
  const navigate = useNavigate();
  const toast = useToast();
  const upcoming = useMeetings('upcoming');
  const [recordings, setRecordings] = useState(null);
  const [creating, setCreating] = useState(false);
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const isHostRole = user.role === 'teacher' || user.role === 'admin';
  const hour = new Date().getHours();
  const greeting = hour < 5 ? 'Good evening' : hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';

  useEffect(() => {
    api('/recordings')
      .then(({ recordings: r }) => setRecordings(r))
      .catch(() => setRecordings([]));
  }, []);

  const [next, ...rest] = upcoming.meetings;
  const todayStr = new Date().toDateString();
  const laterToday = rest.filter((m) => new Date(m.scheduledStart).toDateString() === todayStr);
  const afterToday = rest.filter((m) => new Date(m.scheduledStart).toDateString() !== todayStr);

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

  return (
    <div className="space-y-16">
      {needsVerification && <VerifyBanner />}

      <header className="animate-fade-up">
        <p className="text-[11px] font-medium tracking-[0.28em] text-brand-600 uppercase dark:text-brand-300/80">
          {new Date().toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' })}
        </p>
        <h1 className="animate-reveal mt-4 font-display text-[3.1rem] leading-[1] font-normal sm:text-[4.4rem]">
          {greeting}, <span className="italic">{user.name.split(' ')[0]}</span>.
        </h1>
      </header>

      <section className="grid gap-6 lg:grid-cols-[1.5fr_1fr]">
        {upcoming.loading ? (
          <div className="lamplight flex min-h-[300px] items-center justify-center rounded-[28px] text-vellum/60">
            <Spinner />
          </div>
        ) : next ? (
          <NextClass meeting={next} />
        ) : (
          <ClearCalendar isHost={isHostRole} onSchedule={() => setScheduleOpen(true)} />
        )}
        <div className="flex flex-col gap-6">
          {isHostRole && (
            <div className="card grid grid-cols-2 gap-3 p-3">
              <ActionTile icon={Video} label="Open a room" hint="Start now" onClick={startInstant} busy={creating} disabled={needsVerification} />
              <ActionTile icon={CalendarPlus} label="Schedule" hint="Invite a student" onClick={() => setScheduleOpen(true)} disabled={needsVerification} />
            </div>
          )}
          <JoinCard disabled={needsVerification} />
        </div>
      </section>

      {upcoming.error && <Alert>{upcoming.error}</Alert>}

      {laterToday.length > 0 && (
        <section>
          <SectionTitle eyebrow="Later today" title="The rest of the day" />
          <ol className="divide-y divide-line/80 border-y border-line/80 dark:divide-night-line dark:border-night-line">
            {laterToday.map((m) => (
              <AgendaRow key={m.code} meeting={m} onChanged={upcoming.reload} />
            ))}
          </ol>
        </section>
      )}

      <section>
        <SectionTitle
          eyebrow="Ahead"
          title="On the calendar"
          action={
            <Link to="/calendar" className="inline-flex items-center gap-1.5 text-sm text-ink-2 hover:text-ink dark:text-slate-400 dark:hover:text-vellum" viewTransition>
              <CalendarRange size={15} strokeWidth={1.5} /> Month view
            </Link>
          }
        />
        {upcoming.loading ? (
          <Spinner />
        ) : afterToday.length === 0 ? (
          <Empty>{isHostRole ? 'Nothing further scheduled. Classes you schedule appear here.' : 'Classes you are invited to appear here.'}</Empty>
        ) : (
          <ol className="divide-y divide-line/80 border-y border-line/80 dark:divide-night-line dark:border-night-line">
            {afterToday.slice(0, 8).map((m) => (
              <AgendaRow key={m.code} meeting={m} onChanged={upcoming.reload} />
            ))}
          </ol>
        )}
      </section>

      {recordings?.length > 0 && (
        <section>
          <SectionTitle
            eyebrow="Archive"
            title="Recently recorded"
            action={
              <Link to="/recordings" className="inline-flex items-center gap-1.5 text-sm text-ink-2 hover:text-ink dark:text-slate-400 dark:hover:text-vellum" viewTransition>
                All recordings <ArrowRight size={15} strokeWidth={1.5} />
              </Link>
            }
          />
          <div className="grid gap-x-6 gap-y-8 sm:grid-cols-2 lg:grid-cols-3">
            {recordings.slice(0, 3).map((r) => (
              <RecordingCard key={r.id} rec={r} />
            ))}
          </div>
        </section>
      )}

      <ScheduleModal
        open={scheduleOpen}
        onClose={() => setScheduleOpen(false)}
        onSaved={(m) => {
          setScheduleOpen(false);
          upcoming.reload();
          copyText(m.inviteUrl).then((ok) =>
            toast(m.invitees?.length ? `Scheduled. Invitation sent to ${m.invitees[0]}.` : ok ? 'Scheduled. Invitation link copied.' : 'Scheduled.', { tone: 'success' }),
          );
        }}
      />
    </div>
  );
}

/** The next class, set like an engraved card on lacquer, with a live countdown. */
function NextClass({ meeting: m }) {
  const navigate = useNavigate();
  const toast = useToast();
  const now = useNow(15_000);
  const start = new Date(m.scheduledStart);
  const live = m.status === 'live';
  const soon = !live && start - now < 10 * 60_000;
  return (
    <article className="lamplight relative overflow-hidden rounded-[28px] p-8 text-vellum shadow-[0_40px_90px_-50px_rgba(5,8,18,1)] sm:p-10">
      <Rosette size={520} dense className="pointer-events-none absolute -top-40 -right-44 opacity-[0.26]" />
      <div className="pointer-events-none absolute inset-0 rounded-[28px] shadow-[inset_0_0_0_1px_rgba(216,190,140,.14)]" />
      <div className="relative flex items-center gap-3 text-[11px] font-medium tracking-[0.28em] uppercase">
        {live ? (
          <span className="inline-flex items-center gap-2 text-[#f0a49c]">
            <Radio size={13} className="animate-pulse" /> In session
          </span>
        ) : (
          <span className="text-brand-300/90">Next {m.isHost ? 'class' : 'seat'}</span>
        )}
        <span className="h-px flex-1 bg-gradient-to-r from-brand-300/40 to-transparent" />
      </div>
      <h2 className="relative mt-6 max-w-xl font-display text-[2.3rem] leading-[1.05] sm:text-[2.9rem]">{m.title}</h2>
      <div className="relative mt-5 flex flex-wrap items-baseline gap-x-6 gap-y-2 text-vellum/70">
        <span className="font-display text-[1.7rem] text-vellum tabular-nums">{fmtTime(start)}</span>
        <span>{start.toDateString() === new Date().toDateString() ? 'today' : start.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' })}</span>
        <span>{m.durationMinutes} minutes</span>
        {!m.isHost && m.hostName && <span>with {m.hostName}</span>}
        {m.isHost && m.invitees?.[0] && (
          <span className="inline-flex items-center gap-1.5">
            <Users size={14} strokeWidth={1.5} /> {m.invitees[0]}
          </span>
        )}
      </div>
      <p className="relative mt-8 font-display text-xl text-[#e8d6ae] italic">
        {live ? (m.liveParticipants ? `${m.liveParticipants} already in the room` : 'The room is open') : `Begins ${countdown(start - now)}`}
      </p>
      <div className="relative mt-8 flex flex-wrap gap-3">
        <Button size="lg" onClick={() => navigate(`/m/${m.code}`, { viewTransition: true })} className={soon || live ? '' : 'opacity-95'}>
          {m.isHost ? (live ? 'Return to the room' : 'Open the room') : 'Take your seat'} <ArrowRight size={17} strokeWidth={1.6} />
        </Button>
        {m.isHost && m.inviteUrl && (
          <button
            onClick={() => copyText(m.inviteUrl).then((ok) => toast(ok ? 'Invitation link copied' : m.inviteUrl))}
            className="inline-flex h-12 items-center gap-2 rounded-full border border-vellum/15 px-5 text-[15px] text-vellum/85 transition hover:border-brand-300/50 hover:text-vellum"
          >
            <Copy size={16} strokeWidth={1.5} /> Invitation
          </button>
        )}
        <button
          onClick={() => downloadAuthed(`/meetings/${m.code}/calendar.ics`, `${m.title}.ics`).catch(() => toast('Could not create the calendar file', { tone: 'error' }))}
          className="inline-flex h-12 items-center gap-2 rounded-full px-4 text-[15px] text-vellum/70 transition hover:text-vellum"
        >
          <CalendarPlus size={16} strokeWidth={1.5} /> Add to calendar
        </button>
      </div>
    </article>
  );
}

function ClearCalendar({ isHost, onSchedule }) {
  return (
    <article className="lamplight relative flex min-h-[300px] flex-col justify-end overflow-hidden rounded-[28px] p-8 text-vellum sm:p-10">
      <Rosette size={520} dense className="pointer-events-none absolute -top-40 -right-44 opacity-[0.26]" />
      <div className="pointer-events-none absolute inset-0 rounded-[28px] shadow-[inset_0_0_0_1px_rgba(216,190,140,.14)]" />
      <p className="relative text-[11px] font-medium tracking-[0.28em] text-brand-300/90 uppercase">Nothing scheduled</p>
      <h2 className="relative mt-4 max-w-md font-display text-[2.4rem] leading-[1.05]">Your calendar is clear.</h2>
      <p className="relative mt-3 max-w-md text-vellum/65">
        {isHost ? 'Schedule a one-to-one class and your student receives an invitation and a calendar entry.' : 'When a teacher invites you, the class appears here with a countdown.'}
      </p>
      {isHost && (
        <div className="relative mt-8">
          <Button size="lg" onClick={onSchedule}>
            <CalendarPlus size={17} strokeWidth={1.6} /> Schedule a class
          </Button>
        </div>
      )}
    </article>
  );
}

function ActionTile({ icon: Icon, label, hint, onClick, busy, disabled }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled || busy}
      className="group flex flex-col items-start gap-6 rounded-[18px] border border-transparent p-4 text-left transition hover:border-brand-400/25 hover:bg-brand-400/[0.06] disabled:opacity-50"
    >
      <span className="flex size-10 items-center justify-center rounded-full border border-brand-400/35 text-brand-600 transition group-hover:border-brand-400/70 dark:text-brand-300">
        {busy ? <Spinner size={17} /> : <Icon size={18} strokeWidth={1.5} />}
      </span>
      <span>
        <span className="block font-display text-[1.3rem] leading-tight whitespace-nowrap">{label}</span>
        <span className="text-[13px] text-ink-2 dark:text-slate-400">{hint}</span>
      </span>
    </button>
  );
}

function JoinCard({ disabled }) {
  const navigate = useNavigate();
  const [code, setCode] = useState('');
  const [error, setError] = useState(null);
  const submit = (e) => {
    e.preventDefault();
    const trimmed = code.trim();
    try {
      const url = new URL(trimmed);
      const m = url.pathname.match(/\/m\/([a-z-]+)/i);
      if (m) return navigate(`/m/${m[1].toLowerCase()}${url.search}`);
    } catch {
      /* not a URL */
    }
    const letters = trimmed.toLowerCase().replace(/[^a-z]/g, '');
    if (letters.length !== 10) return setError('Codes look like abc-defg-hij');
    navigate(`/m/${letters.slice(0, 3)}-${letters.slice(3, 7)}-${letters.slice(7)}`);
    return undefined;
  };
  return (
    <form onSubmit={submit} className="card flex-1 p-6 sm:p-7">
      <h2 className="font-display text-[1.7rem] leading-tight font-normal">Join with a code</h2>
      <p className="mt-1 mb-5 text-sm text-ink-2 dark:text-slate-400">Paste the invitation link or type the code.</p>
      <div className="flex gap-2">
        <Field
          className="flex-1"
          placeholder="abc-defg-hij"
          aria-label="Class code or link"
          value={code}
          onChange={(e) => {
            setCode(e.target.value);
            setError(null);
          }}
          error={error}
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
        />
        <Button type="submit" disabled={!code.trim() || disabled} className="h-[46px]" aria-label="Join">
          <LogIn size={17} strokeWidth={1.6} />
        </Button>
      </div>
    </form>
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
