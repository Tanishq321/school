import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, ArrowRight, CalendarPlus, Check, Copy, Download, Mail, PencilLine, Repeat, Trash2, UserCheck, UserRound } from 'lucide-react';
import { useToast } from '../contexts/ToastContext.jsx';
import { api } from '../services/api.js';
import { Alert, Button, FullPageSpinner } from '../components/ui/index.jsx';
import { CancelClassModal, downloadAttendance, downloadAuthed, RecordingCard, ScheduleModal, SectionTitle, StatusBadge } from '../components/classes/index.jsx';
import { LessonEditor, LessonView } from '../components/classes/Lesson.jsx';
import { copyText, fmtDateTime, fmtDuration, fmtTime } from '../utils/format.js';

export default function ClassDetailPage() {
  const { code } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const [data, setData] = useState(null);
  const [editing, setEditing] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const load = useCallback(() => {
    api(`/meetings/${code}/summary`)
      .then(setData)
      .catch((err) => setData({ error: err.message }));
  }, [code]);
  useEffect(load, [load]);

  if (!data) return <FullPageSpinner />;
  if (data.error) {
    return (
      <div className="space-y-6">
        <BackLink />
        <Alert>{data.error}</Alert>
      </div>
    );
  }
  const m = data.meeting;
  const isHost = m.isHost;
  const closed = ['ended', 'expired', 'cancelled'].includes(m.status);
  const start = new Date(m.startedAt || m.scheduledStart);
  const length = m.startedAt && m.endedAt ? fmtDuration((new Date(m.endedAt) - new Date(m.startedAt)) / 1000) : `${m.durationMinutes} minutes`;

  return (
    <div className="space-y-14">
      <BackLink />
      <header className="relative">
        <div className="flex flex-wrap items-center gap-3 text-[11px] font-medium tracking-[0.28em] text-brand-600 uppercase dark:text-brand-300/80">
          <span>{start.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}</span>
          {m.status !== 'ended' && <StatusBadge status={m.status} />}
        </div>
        <h1 className="mt-4 max-w-3xl font-display text-[2.8rem] leading-[1.02] font-normal sm:text-[3.8rem]">{m.title}</h1>
        <p className="mt-4 flex flex-wrap gap-x-6 gap-y-1 text-ink-2 dark:text-slate-400">
          <span className="tabular-nums">{fmtTime(start)}</span>
          <span>{length}</span>
          {!isHost && m.hostName && <span>with {m.hostName}</span>}
          {isHost && <span className="tracking-[0.08em] tabular-nums">{m.code}</span>}
        </p>
        {m.description && <p className="mt-6 max-w-2xl text-[17px] leading-relaxed whitespace-pre-line text-ink/85 dark:text-vellum/80">{m.description}</p>}
        <div className="mt-8 flex flex-wrap gap-3">
          {!closed && (
            <Button size="lg" onClick={() => navigate(`/m/${m.code}`, { viewTransition: true })}>
              {isHost ? (m.status === 'live' ? 'Return to the room' : 'Open the room') : 'Take your seat'} <ArrowRight size={17} strokeWidth={1.6} />
            </Button>
          )}
          {!closed && (
            <Button size="lg" variant="secondary" onClick={() => downloadAuthed(`/meetings/${m.code}/calendar.ics`, `${m.title}.ics`).catch(() => toast('Could not create the calendar file', { tone: 'error' }))}>
              <CalendarPlus size={17} strokeWidth={1.5} /> Add to calendar
            </Button>
          )}
          {isHost && !closed && (
            <>
              <Button size="lg" variant="ghost" onClick={() => copyText(m.inviteUrl).then((ok) => toast(ok ? 'Invitation link copied' : m.inviteUrl))}>
                <Copy size={16} strokeWidth={1.5} /> Invitation link
              </Button>
              {m.status === 'scheduled' && (
                <>
                  <Button size="lg" variant="ghost" onClick={() => setEditing(true)}>
                    <PencilLine size={16} strokeWidth={1.5} /> Edit
                  </Button>
                  <Button size="lg" variant="ghost" onClick={() => setCancelling(true)}>
                    <Trash2 size={16} strokeWidth={1.5} /> Cancel
                  </Button>
                </>
              )}
            </>
          )}
        </div>
        {data.series && <SeriesStrip series={data.series} current={m.code} />}
      </header>

      <div className={`grid gap-14 ${isHost ? 'lg:grid-cols-[1fr_340px]' : ''}`}>
        <div className="min-w-0 space-y-14">
          {isHost ? (
            <LessonEditor key={m.code} code={m.code} lesson={data.lesson} studentEmail={m.invitees?.[0]} studentName={data.guests?.[0]?.name} />
          ) : (
            <LessonView code={m.code} lesson={data.lesson} hostName={m.hostName} />
          )}

          <section className="reveal">
            <SectionTitle eyebrow="Archive" title="Recordings" />
            {data.recordings.length === 0 ? (
              <p className="text-ink-2 dark:text-slate-400">{isHost ? 'This class was not recorded.' : 'No recording has been shared for this class.'}</p>
            ) : (
              <div className="grid gap-x-6 gap-y-8 sm:grid-cols-2">
                {data.recordings.map((r) => (
                  <RecordingCard key={r.id} rec={r} />
                ))}
              </div>
            )}
          </section>

          {isHost && data.attendance && (
            <section className="reveal">
              <SectionTitle
                eyebrow="Register"
                title="Attendance"
                action={
                  data.attendance.length > 0 && (
                    <Button size="sm" variant="secondary" onClick={() => downloadAttendance(m, data.attendance)}>
                      <Download size={14} strokeWidth={1.6} /> CSV
                    </Button>
                  )
                }
              />
              {data.attendance.length === 0 ? (
                <p className="text-ink-2 dark:text-slate-400">Nobody has joined yet.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-sm">
                    <thead className="text-[11px] tracking-[0.16em] text-ink-2 uppercase dark:text-slate-400">
                      <tr className="border-b border-line/80 dark:border-night-line">
                        <th className="py-2.5 pr-4 font-medium">Name</th>
                        <th className="py-2.5 pr-4 font-medium">Arrived</th>
                        <th className="py-2.5 pr-4 font-medium">Time in class</th>
                        <th className="py-2.5 font-medium">Sessions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-line/70 dark:divide-night-line">
                      {data.attendance.map((a) => (
                        <tr key={a.user.id}>
                          <td className="py-3 pr-4 font-medium">
                            {a.user.name} {a.role === 'host' && <span className="ml-1 text-xs font-normal text-brand-600 dark:text-brand-300">host</span>}
                          </td>
                          <td className="py-3 pr-4 tabular-nums">{fmtTime(a.firstJoinedAt)}</td>
                          <td className="py-3 pr-4 tabular-nums">{a.present ? 'In class now' : fmtDuration(a.totalSeconds)}</td>
                          <td className="py-3 tabular-nums">{a.sessions}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          )}

          {isHost && data.transcript && (
            <section className="reveal">
              <SectionTitle
                eyebrow="Correspondence"
                title="Chat transcript"
                action={
                  data.transcript.length > 0 && (
                    <Button size="sm" variant="secondary" onClick={() => downloadTranscript(m, data.transcript)}>
                      <Download size={14} strokeWidth={1.6} /> Text file
                    </Button>
                  )
                }
              />
              {data.transcript.length === 0 ? (
                <p className="text-ink-2 dark:text-slate-400">No messages were exchanged{m.settings?.saveChat === false ? ' (chat saving is off for this class)' : ''}.</p>
              ) : (
                <ol className="max-h-[480px] space-y-4 overflow-y-auto border-l border-brand-400/30 pl-6">
                  {data.transcript.map((c) => (
                    <li key={c.id}>
                      <p className="text-[12px] text-ink-2 dark:text-slate-400">
                        <span className={`font-medium ${c.isHost ? 'text-brand-600 dark:text-brand-300' : 'text-ink dark:text-vellum'}`}>{c.name}</span> · <span className="tabular-nums">{fmtTime(c.at)}</span>
                      </p>
                      <p className="mt-0.5 whitespace-pre-wrap [overflow-wrap:anywhere]">{c.text}</p>
                    </li>
                  ))}
                </ol>
              )}
            </section>
          )}
        </div>

        {isHost && (
          <aside className="space-y-10">
            <Notes code={m.code} initial={data.notes} />
            <section className="reveal">
              <h3 className="mb-4 text-[11px] font-medium tracking-[0.24em] text-brand-600 uppercase dark:text-brand-300/80">Student</h3>
              {data.guests?.length ? (
                <ul className="space-y-2.5">
                  {data.guests.map((g) => (
                    <li key={g.email} className="flex items-center gap-3 text-sm">
                      <span className="flex size-8 shrink-0 items-center justify-center rounded-full border border-brand-400/30 text-brand-600 dark:text-brand-300">
                        {g.hasAccount ? <UserCheck size={14} strokeWidth={1.6} /> : <Mail size={14} strokeWidth={1.6} />}
                      </span>
                      <span className="min-w-0">
                        <span className="block truncate font-medium">{g.name || g.email}</span>
                        {g.name && <span className="block truncate text-xs text-ink-2 dark:text-slate-400">{g.email}</span>}
                        {!g.hasAccount && <span className="block text-xs text-ink-2 dark:text-slate-400">Invited · no account yet</span>}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-ink-2 dark:text-slate-400">
                  <UserRound size={14} className="mr-1 inline" strokeWidth={1.5} /> No student was invited by email. Share the invitation link instead.
                </p>
              )}
            </section>
          </aside>
        )}
      </div>

      {isHost && <CancelClassModal meeting={m} open={cancelling} onClose={() => setCancelling(false)} onDone={load} />}
      {isHost && (
        <ScheduleModal
          open={editing}
          meeting={m}
          onClose={() => setEditing(false)}
          onSaved={(saved) => {
            setEditing(false);
            load();
            const invited = saved.invitees?.[0] && saved.invitees[0] !== m.invitees?.[0];
            toast(invited ? `Saved. Invitation sent to ${saved.invitees[0]}.` : 'Saved.', { tone: 'success' });
          }}
        />
      )}
    </div>
  );
}

/** Every lesson of a weekly series, as a row of dated stops; the current one is marked. */
function SeriesStrip({ series, current }) {
  const total = series.lessons.length;
  const index = series.lessons.findIndex((l) => l.code === current);
  return (
    <div className="mt-10" data-testid="series">
      <p className="mb-3 flex items-center gap-2 text-[11px] font-medium tracking-[0.24em] text-brand-600 uppercase dark:text-brand-300/80">
        <Repeat size={13} strokeWidth={1.6} /> Weekly series · lesson {index + 1} of {total}
      </p>
      <ol className="flex gap-1.5 overflow-x-auto pb-2">
        {series.lessons.map((l) => {
          const d = new Date(l.scheduledStart);
          const here = l.code === current;
          const gone = l.status === 'cancelled';
          const past = ['ended', 'expired'].includes(l.status);
          return (
            <li key={l.code}>
              <Link
                to={`/classes/${l.code}`}
                viewTransition
                aria-current={here ? 'page' : undefined}
                className={`flex w-[4.4rem] flex-col items-center rounded-2xl border px-2 py-2.5 text-center transition ${
                  here ? 'border-brand-400/70 bg-brand-400/10' : 'border-line/70 hover:border-brand-400/50 dark:border-night-line'
                } ${gone ? 'opacity-45' : ''}`}
              >
                <span className="text-[10px] tracking-[0.16em] text-ink-2 uppercase dark:text-slate-400">{d.toLocaleDateString(undefined, { month: 'short' })}</span>
                <span className={`font-display text-[1.45rem] leading-tight tabular-nums ${gone ? 'line-through' : ''}`}>{d.getDate()}</span>
                <span className={`mt-1 size-1.5 rounded-full ${past ? 'bg-brand-500' : gone ? 'bg-transparent' : 'border border-brand-400/70'}`} />
              </Link>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

const BackLink = () => (
  <Link to="/classes" viewTransition className="inline-flex items-center gap-2 text-sm text-ink-2 hover:text-ink dark:text-slate-400 dark:hover:text-vellum">
    <ArrowLeft size={15} strokeWidth={1.5} /> Classes
  </Link>
);

function downloadTranscript(m, rows) {
  const text = [`${m.title} — chat transcript`, fmtDateTime(m.startedAt || m.scheduledStart), '', ...rows.map((c) => `[${new Date(c.at).toLocaleTimeString()}] ${c.name}: ${c.text}`)].join('\r\n');
  const url = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = `transcript-${m.code}.txt`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** The host's private notes: saved as they write, never shown to students. */
function Notes({ code, initial }) {
  const [text, setText] = useState(initial || '');
  const [state, setState] = useState('saved');
  const timer = useRef(null);
  const latest = useRef(text);
  const save = useCallback(async () => {
    setState('saving');
    try {
      await api(`/meetings/${code}/notes`, { method: 'PUT', body: { notes: latest.current } });
      setState('saved');
    } catch {
      setState('error');
    }
  }, [code]);
  useEffect(() => () => clearTimeout(timer.current), []);
  return (
    <section>
      <div className="mb-4 flex items-center justify-between">
        <h3 className="text-[11px] font-medium tracking-[0.24em] text-brand-600 uppercase dark:text-brand-300/80">Private notes</h3>
        <span className="flex items-center gap-1 text-xs text-ink-2 dark:text-slate-400" aria-live="polite">
          {state === 'saving' ? 'Saving…' : state === 'error' ? <span className="text-danger">Not saved</span> : state === 'dirty' ? 'Editing' : (
            <>
              <Check size={12} /> Saved
            </>
          )}
        </span>
      </div>
      <textarea
        value={text}
        maxLength={20000}
        onChange={(e) => {
          setText(e.target.value);
          latest.current = e.target.value;
          setState('dirty');
          clearTimeout(timer.current);
          timer.current = setTimeout(save, 900);
        }}
        onBlur={() => state === 'dirty' && (clearTimeout(timer.current), save())}
        placeholder="What was covered, who needs attention, what to set for next time. Only you can see this."
        aria-label="Private notes"
        className="min-h-[260px] w-full resize-y rounded-[18px] border border-line/80 bg-[#fbf8f1] p-5 font-display text-[17px] leading-[30px] text-ink shadow-[inset_0_1px_0_rgba(255,255,255,.7),0_18px_40px_-30px_rgba(22,28,44,.4)] outline-none placeholder:text-ink-2/50 focus:border-brand-400 dark:border-night-line dark:bg-night-2/80 dark:text-vellum dark:placeholder:text-vellum/30"
        style={{ backgroundImage: 'repeating-linear-gradient(transparent 0 29px, rgba(173,136,81,.13) 29px 30px)', backgroundPositionY: '19px' }}
      />
    </section>
  );
}
