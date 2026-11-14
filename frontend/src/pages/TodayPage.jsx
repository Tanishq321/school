import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowRight, BookOpenCheck, CalendarPlus, CalendarRange, Copy, LogIn, MailWarning, NotebookPen, Radio, Users, Video } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext.jsx';
import { useToast } from '../contexts/ToastContext.jsx';
import { api } from '../services/api.js';
import { Alert, Button, Field, Spinner } from '../components/ui/index.jsx';
import { Rosette } from '../components/brand/Guilloche.jsx';
import { AgendaRow, countdown, downloadAuthed, Empty, RecordingCard, ScheduleModal, scheduledMessage, SectionTitle, useMeetings, useNow } from '../components/classes/index.jsx';
import { copyText, fmtTime } from '../utils/format.js';

export default function TodayPage() {
  const { user, needsVerification } = useAuth();
  const navigate = useNavigate();
  const toast = useToast();
  const upcoming = useMeetings('upcoming');
  const past = useMeetings('past');
  const [recordings, setRecordings] = useState(null);
  const [creating, setCreating] = useState(false);
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const isHostRole = user.role === 'teacher' || user.role === 'admin';
  const stats = useStats(isHostRole ? 'week' : 'month');
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
          <div className="lamplight flex min-h-[300px] items-center justify-center rounded-[28px] text-hi/60">
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
          {!isHostRole && <PrepCard />}
        </div>
      </section>

      {upcoming.error && <Alert>{upcoming.error}</Alert>}

      <Ledger stats={stats.data} isHost={isHostRole} />

      {isHostRole ? <NotesToWrite meetings={past.meetings} /> : <FromYourTeachers meetings={past.meetings} />}

      {laterToday.length > 0 && (
        <section className="reveal">
          <SectionTitle eyebrow="Later today" title="The rest of the day" />
          <ol className="divide-y divide-line/80 border-y border-line/80 dark:divide-night-line dark:border-night-line">
            {laterToday.map((m) => (
              <AgendaRow key={m.code} meeting={m} onChanged={upcoming.reload} />
            ))}
          </ol>
        </section>
      )}

      <section className="reveal">
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
        <section className="reveal">
          <SectionTitle
            eyebrow="Archive"
            title="Recently recorded"
            action={
              <Link to="/recordings" className="inline-flex items-center gap-1.5 text-sm text-ink-2 hover:text-ink dark:text-slate-400 dark:hover:text-vellum" viewTransition>
                All recordings <ArrowRight size={15} strokeWidth={1.5} />
              </Link>
            }
          />
          <div className="reveal-stagger grid gap-x-6 gap-y-8 sm:grid-cols-2 lg:grid-cols-3">
            {recordings.slice(0, 3).map((r) => (
              <RecordingCard key={r.id} rec={r} />
            ))}
          </div>
        </section>
      )}

      <ScheduleModal
        open={scheduleOpen}
        onClose={() => setScheduleOpen(false)}
        onSaved={(m, series) => {
          setScheduleOpen(false);
          upcoming.reload();
          stats.reload();
          (m.invitees?.length ? Promise.resolve(false) : copyText(m.inviteUrl)).then((ok) => toast(scheduledMessage(m, series, ok), { tone: 'success' }));
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
    <article className="lamplight relative overflow-hidden rounded-[28px] p-8 text-hi elevated sm:p-10">
      <Rosette size={520} dense className="pointer-events-none absolute -top-40 -right-44 opacity-[0.26]" />
            <div className="relative flex items-center gap-3 text-[11px] font-medium tracking-[0.28em] uppercase">
        {live ? (
          <span className="inline-flex items-center gap-2 text-danger dark:text-[#f0a49c]">
            <Radio size={13} className="animate-pulse" /> In session
          </span>
        ) : (
          <span className="text-brass">Next {m.isHost ? 'class' : 'seat'}</span>
        )}
        <span className="h-px flex-1 bg-gradient-to-r from-brass/40 to-transparent" />
      </div>
      <h2 className="relative mt-6 max-w-xl font-display text-[2.3rem] leading-[1.05] sm:text-[2.9rem]">{m.title}</h2>
      <div className="relative mt-5 flex flex-wrap items-baseline gap-x-6 gap-y-2 text-hi/70">
        <span className="font-display text-[1.7rem] text-hi tabular-nums">{fmtTime(start)}</span>
        <span>{start.toDateString() === new Date().toDateString() ? 'today' : start.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' })}</span>
        <span>{m.durationMinutes} minutes</span>
        {!m.isHost && m.hostName && <span>with {m.hostName}</span>}
        {m.isHost && m.invitees?.[0] && (
          <span className="inline-flex items-center gap-1.5">
            <Users size={14} strokeWidth={1.5} /> {m.invitees[0]}
          </span>
        )}
      </div>
      <p className="relative mt-8 font-display text-xl text-brass italic">
        {live ? (m.liveParticipants ? `${m.liveParticipants} already in the room` : 'The room is open') : `Begins ${countdown(start - now)}`}
      </p>
      <div className="relative mt-8 flex flex-wrap gap-3">
        <Button size="lg" onClick={() => navigate(`/m/${m.code}`, { viewTransition: true })} className={soon || live ? '' : 'opacity-95'}>
          {m.isHost ? (live ? 'Return to the room' : 'Open the room') : 'Take your seat'} <ArrowRight size={17} strokeWidth={1.6} />
        </Button>
        {m.isHost && m.inviteUrl && (
          <button
            onClick={() => copyText(m.inviteUrl).then((ok) => toast(ok ? 'Invitation link copied' : m.inviteUrl))}
            className="inline-flex h-12 items-center gap-2 rounded-full border border-hi/15 px-5 text-[15px] text-hi/85 transition hover:border-brass/60 hover:text-hi"
          >
            <Copy size={16} strokeWidth={1.5} /> Invitation
          </button>
        )}
        <button
          onClick={() => downloadAuthed(`/meetings/${m.code}/calendar.ics`, `${m.title}.ics`).catch(() => toast('Could not create the calendar file', { tone: 'error' }))}
          className="inline-flex h-12 items-center gap-2 rounded-full px-4 text-[15px] text-hi/70 transition hover:text-hi"
        >
          <CalendarPlus size={16} strokeWidth={1.5} /> Add to calendar
        </button>
      </div>
    </article>
  );
}

function ClearCalendar({ isHost, onSchedule }) {
  return (
    <article className="lamplight elevated relative flex min-h-[300px] flex-col justify-end overflow-hidden rounded-[28px] p-8 text-hi sm:p-10">
      <Rosette size={520} dense className="pointer-events-none absolute -top-40 -right-44 opacity-[0.26]" />
            <p className="relative text-[11px] font-medium tracking-[0.28em] text-brass uppercase">Nothing scheduled</p>
      <h2 className="relative mt-4 max-w-md font-display text-[2.4rem] leading-[1.05]">Your calendar is clear.</h2>
      <p className="relative mt-3 max-w-md text-hi/65">
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
    <form onSubmit={submit} className="card p-6 sm:p-7">
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

/** Figures for the person's own local week (teachers) or month (students). */
function useStats(span) {
  const [data, setData] = useState(null);
  const load = useCallback(() => {
    const now = new Date();
    let from;
    let to;
    if (span === 'week') {
      from = new Date(now.getFullYear(), now.getMonth(), now.getDate() - ((now.getDay() + 6) % 7));
      to = new Date(from.getFullYear(), from.getMonth(), from.getDate() + 7);
    } else {
      from = new Date(now.getFullYear(), now.getMonth(), 1);
      to = new Date(now.getFullYear(), now.getMonth() + 1, 1);
    }
    api(`/me/stats?from=${encodeURIComponent(from.toISOString())}&to=${encodeURIComponent(to.toISOString())}`)
      .then(setData)
      .catch(() => setData(null));
  }, [span]);
  useEffect(load, [load]);
  return { data, reload: load };
}

function LedgerFigure({ value, label, hint, to }) {
  const body = (
    <>
      <p className="font-display text-[2.6rem] leading-none tabular-nums sm:text-[3rem]">{value}</p>
      <p className="mt-2.5 text-[11px] tracking-[0.2em] text-ink-2 uppercase dark:text-slate-400">{label}</p>
      {hint && <p className="mt-1 text-xs text-ink-2/80 dark:text-slate-500">{hint}</p>}
    </>
  );
  return to ? (
    <Link to={to} viewTransition className="group block rounded-xl transition hover:text-brand-600 dark:hover:text-brand-300">
      {body}
    </Link>
  ) : (
    <div>{body}</div>
  );
}

/** A ruled ledger of the period's figures: the teacher's week, the student's month. */
function Ledger({ stats, isHost }) {
  if (!stats) return null;
  const month = new Date().toLocaleDateString(undefined, { month: 'long' });
  const figures =
    stats.role === 'teacher'
      ? [
          { value: stats.lessons, label: stats.lessons === 1 ? 'Lesson this week' : 'Lessons this week', hint: stats.lessonsHeld ? `${stats.lessonsHeld} held so far` : null },
          { value: stats.hoursTaught, label: 'Hours taught', hint: `${stats.hoursBooked} booked` },
          { value: stats.activeStudents, label: stats.activeStudents === 1 ? 'Student' : 'Students', hint: 'this month and next', to: '/students' },
          { value: stats.notesToWrite, label: 'Notes to write', hint: stats.notesToWrite ? 'for recent lessons' : 'all written' },
        ]
      : [
          { value: stats.lessons, label: `Lessons in ${month}` },
          { value: stats.hours, label: 'Hours of study' },
          { value: stats.homeworkOpen, label: 'Homework to do', hint: stats.homeworkDone ? `${stats.homeworkDone} done` : null },
          { value: stats.streakWeeks, label: stats.streakWeeks === 1 ? 'Week in a row' : 'Weeks in a row', hint: stats.streakWeeks ? 'with a lesson' : 'starts with your next lesson' },
        ];
  return (
    <section className="reveal" data-testid="ledger" aria-label={isHost ? 'This week' : 'This month'}>
      <p className="mb-5 text-[11px] font-medium tracking-[0.24em] text-brand-600 uppercase dark:text-brand-300/80">{isHost ? 'This week' : `${month}, so far`}</p>
      <div className="grid grid-cols-2 gap-x-6 gap-y-9 border-y border-line/80 py-9 sm:grid-cols-4 sm:divide-x sm:divide-line/80 dark:border-night-line sm:dark:divide-night-line [&>*]:sm:pl-6 [&>*:first-child]:sm:pl-0">
        {figures.map((f) => (
          <LedgerFigure key={f.label} {...f} />
        ))}
      </div>
    </section>
  );
}

const recent = (m, days) => new Date(m.endedAt || m.scheduledStart) > Date.now() - days * 86_400_000;

/** Teachers: recent lessons with a student that still have no notes for them. */
function NotesToWrite({ meetings }) {
  const due = meetings.filter((m) => m.status === 'ended' && m.invitees?.length && !m.hasLessonNotes && recent(m, 14)).slice(0, 4);
  if (!due.length) return null;
  return (
    <section className="reveal" data-testid="notes-to-write">
      <SectionTitle eyebrow="After the lesson" title="Notes to write" />
      <ol className="divide-y divide-line/80 border-y border-line/80 dark:divide-night-line dark:border-night-line">
        {due.map((m) => (
          <li key={m.code}>
            <Link to={`/classes/${m.code}`} viewTransition className="group flex items-center gap-5 py-5">
              <NotebookPen size={18} strokeWidth={1.4} className="shrink-0 text-brand-600 dark:text-brand-300" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-lg font-medium decoration-brand-400/60 underline-offset-4 group-hover:underline">{m.title}</span>
                <span className="text-[13px] text-ink-2 dark:text-slate-400">
                  {new Date(m.startedAt || m.scheduledStart).toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' })} · {m.invitees[0]}
                </span>
              </span>
              <span className="text-sm text-brand-600 dark:text-brand-300">Write a summary and homework</span>
              <ArrowRight size={16} strokeWidth={1.4} className="text-ink-2/50 transition group-hover:translate-x-0.5" />
            </Link>
          </li>
        ))}
      </ol>
    </section>
  );
}

/** Students: lessons their teacher has written up, homework still open first. */
function FromYourTeachers({ meetings }) {
  const written = meetings
    .filter((m) => m.hasLessonNotes && (m.homeworkOpen > 0 || recent(m, 21)))
    .sort((a, b) => b.homeworkOpen - a.homeworkOpen || new Date(b.scheduledStart) - new Date(a.scheduledStart))
    .slice(0, 4);
  if (!written.length) return null;
  return (
    <section className="reveal" data-testid="from-teacher">
      <SectionTitle eyebrow="From your teachers" title="Notes and homework" />
      <div className="reveal-stagger grid gap-4 sm:grid-cols-2">
        {written.map((m) => (
          <Link key={m.code} to={`/classes/${m.code}`} viewTransition className="card group block p-6 transition hover:-translate-y-0.5">
            <p className="text-[11px] tracking-[0.2em] text-ink-2 uppercase dark:text-slate-400">
              {new Date(m.startedAt || m.scheduledStart).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })}
              {m.hostName && ` · ${m.hostName}`}
            </p>
            <p className="mt-2 font-display text-[1.5rem] leading-tight">{m.title}</p>
            <p className="mt-4 flex items-center gap-2 text-sm">
              <BookOpenCheck size={15} strokeWidth={1.5} className="text-brand-600 dark:text-brand-300" />
              {m.homeworkTotal === 0 ? 'Notes from the lesson' : m.homeworkOpen === 0 ? 'All homework done' : `${m.homeworkOpen} of ${m.homeworkTotal} still to do`}
              <ArrowRight size={15} strokeWidth={1.4} className="ml-auto text-ink-2/50 transition group-hover:translate-x-0.5" />
            </p>
          </Link>
        ))}
      </div>
    </section>
  );
}

/** Students: a quiet reminder to check the room before a lesson. */
function PrepCard() {
  return (
    <Link to="/diagnostics" viewTransition className="card group flex items-start gap-4 p-6 transition hover:-translate-y-0.5 sm:p-7" data-testid="prep-card">
      <span className="flex size-10 shrink-0 items-center justify-center rounded-full border border-brand-400/35 text-brand-600 dark:text-brand-300">
        <Video size={18} strokeWidth={1.5} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block font-display text-[1.35rem] leading-tight">Before your lesson</span>
        <span className="mt-1 block text-sm text-ink-2 dark:text-slate-400">Check your camera, microphone and connection in under a minute.</span>
      </span>
      <ArrowRight size={16} strokeWidth={1.4} className="mt-1 text-ink-2/50 transition group-hover:translate-x-0.5" />
    </Link>
  );
}
