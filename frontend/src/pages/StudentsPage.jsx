import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, ArrowRight, BookOpenCheck, CalendarPlus, Check, Minus, NotebookPen, Repeat } from 'lucide-react';
import { useToast } from '../contexts/ToastContext.jsx';
import { api } from '../services/api.js';
import { Alert, Avatar, Button, FullPageSpinner } from '../components/ui/index.jsx';
import { countdown, Empty, ScheduleModal, scheduledMessage, SectionTitle, StatusBadge, useNow } from '../components/classes/index.jsx';
import { fmtTime } from '../utils/format.js';

const fmtDay = (d) => new Date(d).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
const display = (s) => s.name || s.email;

/** Homework done out of set, as a thin brass rule. */
function HomeworkBar({ done, open }) {
  const total = done + open;
  if (!total) return <span className="text-xs text-ink-2/70 dark:text-slate-500">No homework set</span>;
  return (
    <span className="flex items-center gap-3 sm:justify-end">
      <span className="h-[3px] w-20 overflow-hidden rounded-full bg-line/70 dark:bg-night-line">
        <span className="block h-full rounded-full bg-[linear-gradient(90deg,#86663a,#d8be8c)]" style={{ width: `${(done / total) * 100}%` }} />
      </span>
      <span className="text-xs text-ink-2 tabular-nums dark:text-slate-400">
        {done}/{total} done
      </span>
    </span>
  );
}

function Figure({ value, label, hint }) {
  return (
    <div className="min-w-0">
      <p className="font-display text-[2.4rem] leading-none tabular-nums">{value ?? '–'}</p>
      <p className="mt-2 text-[11px] tracking-[0.2em] text-ink-2 uppercase dark:text-slate-400">{label}</p>
      {hint && <p className="mt-1 text-xs text-ink-2/80 dark:text-slate-500">{hint}</p>}
    </div>
  );
}

/** The teacher's register: everyone they teach, next lesson first. */
export default function StudentsPage() {
  const toast = useToast();
  const [data, setData] = useState(null);
  const [scheduling, setScheduling] = useState(false);
  const load = useCallback(() => {
    api('/students')
      .then(({ students }) => setData({ students }))
      .catch((err) => setData({ error: err.message }));
  }, []);
  useEffect(load, [load]);

  if (!data) return <FullPageSpinner />;
  const students = data.students ?? [];
  const booked = students.reduce((t, s) => t + s.upcoming, 0);
  const openHw = students.reduce((t, s) => t + s.homeworkOpen, 0);

  return (
    <div className="space-y-14">
      <header className="animate-fade-up flex flex-wrap items-end justify-between gap-6">
        <div>
          <p className="text-[11px] font-medium tracking-[0.28em] text-brand-600 uppercase dark:text-brand-300/80">Register</p>
          <h1 className="mt-4 font-display text-[3rem] leading-none font-normal sm:text-[3.8rem]">Your students</h1>
          <p className="mt-4 max-w-xl text-ink-2 dark:text-slate-400">Everyone you teach one-to-one: when you next see them, how often they come, and how their homework stands.</p>
        </div>
        <Button size="lg" onClick={() => setScheduling(true)}>
          <CalendarPlus size={17} strokeWidth={1.6} /> Schedule a lesson
        </Button>
      </header>

      {data.error && <Alert>{data.error}</Alert>}

      {students.length > 0 && (
        <section className="grid grid-cols-3 gap-6 border-y border-line/80 py-8 dark:border-night-line">
          <Figure value={students.length} label={students.length === 1 ? 'Student' : 'Students'} />
          <Figure value={booked} label="Lessons booked" />
          <Figure value={openHw} label="Homework open" />
        </section>
      )}

      {students.length === 0 && !data.error ? (
        <Empty>Students appear here once you schedule a class with their email address.</Empty>
      ) : (
        <ol className="reveal-stagger divide-y divide-line/80 border-y border-line/80 dark:divide-night-line dark:border-night-line" data-testid="roster">
          {students.map((s) => (
            <li key={s.email}>
              <Link to={`/students/${encodeURIComponent(s.email)}`} viewTransition className="group grid items-center gap-x-6 gap-y-3 py-6 sm:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_auto]">
                <span className="flex min-w-0 items-center gap-4">
                  <Avatar name={display(s)} size={46} />
                  <span className="min-w-0">
                    <span className="block truncate font-display text-[1.45rem] leading-tight decoration-brand-400/60 underline-offset-4 group-hover:underline">{display(s)}</span>
                    <span className="block truncate text-[13px] text-ink-2 dark:text-slate-400">
                      {s.name ? s.email : 'Invited · no account yet'}
                      {s.inSeries && (
                        <span className="ml-2 inline-flex items-center gap-1 align-middle">
                          <Repeat size={11} strokeWidth={1.6} /> Weekly
                        </span>
                      )}
                    </span>
                  </span>
                </span>
                <span className="text-sm">
                  {s.nextLesson ? (
                    <>
                      <span className="block text-[11px] tracking-[0.18em] text-brand-600 uppercase dark:text-brand-300/80">Next</span>
                      <span className="tabular-nums">
                        {fmtDay(s.nextLesson.at)}, {fmtTime(s.nextLesson.at)}
                      </span>
                    </>
                  ) : (
                    <>
                      <span className="block text-[11px] tracking-[0.18em] text-ink-2 uppercase dark:text-slate-400">Nothing booked</span>
                      <span className="text-ink-2 dark:text-slate-400">{s.lastLesson ? `Last seen ${fmtDay(s.lastLesson.at)}` : 'No lessons yet'}</span>
                    </>
                  )}
                </span>
                <span className="flex items-center justify-between gap-6 sm:justify-end">
                  <span className="text-sm sm:text-right">
                    <span className="block tabular-nums">
                      {s.lessonsHeld} {s.lessonsHeld === 1 ? 'lesson' : 'lessons'} · {s.hoursTaught} h
                    </span>
                    <HomeworkBar done={s.homeworkDone} open={s.homeworkOpen} />
                  </span>
                  <ArrowRight size={17} strokeWidth={1.4} className="text-ink-2/50 transition group-hover:translate-x-0.5 group-hover:text-brand-500" />
                </span>
              </Link>
            </li>
          ))}
        </ol>
      )}

      <ScheduleModal
        open={scheduling}
        onClose={() => setScheduling(false)}
        onSaved={(m, series) => {
          setScheduling(false);
          load();
          toast(scheduledMessage(m, series), { tone: 'success' });
        }}
      />
    </div>
  );
}

/** One student: figures, the next lessons, and every lesson so far with its notes and homework. */
export function StudentPage() {
  const { email } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const now = useNow(30_000);
  const [data, setData] = useState(null);
  const [scheduling, setScheduling] = useState(false);
  const load = useCallback(() => {
    api(`/students/${encodeURIComponent(email)}`)
      .then(setData)
      .catch((err) => setData({ error: err.message }));
  }, [email]);
  useEffect(load, [load]);

  if (!data) return <FullPageSpinner />;
  const back = (
    <Link to="/students" viewTransition className="inline-flex items-center gap-2 text-sm text-ink-2 hover:text-ink dark:text-slate-400 dark:hover:text-vellum">
      <ArrowLeft size={15} strokeWidth={1.5} /> Students
    </Link>
  );
  if (data.error) {
    return (
      <div className="space-y-6">
        {back}
        <Alert>{data.error}</Alert>
      </div>
    );
  }
  const s = data.student;
  const ahead = s.lessons.filter((l) => ['scheduled', 'live'].includes(l.status) && new Date(l.at) > now - 3 * 3_600_000);
  const past = s.lessons.filter((l) => !ahead.includes(l)).reverse();

  return (
    <div className="space-y-14">
      {back}
      <header className="lamplight elevated relative overflow-hidden rounded-[28px] p-8 text-hi sm:p-10">
        <div className="relative flex flex-wrap items-center gap-6">
          <Avatar name={display(s)} size={76} />
          <div className="min-w-0 flex-1">
            <p className="text-[11px] font-medium tracking-[0.28em] text-brass uppercase">Student</p>
            <h1 className="mt-2 truncate font-display text-[2.6rem] leading-none sm:text-[3.2rem]">{display(s)}</h1>
            <p className="mt-2 truncate text-hi/60">{s.name ? s.email : 'Invited · no account yet'}</p>
          </div>
          <Button size="lg" onClick={() => setScheduling(true)}>
            <CalendarPlus size={17} strokeWidth={1.6} /> Schedule a lesson
          </Button>
        </div>
        <div className="relative mt-10 grid grid-cols-2 gap-8 border-t border-hi/10 pt-8 sm:grid-cols-4">
          <Figure value={s.lessonsHeld} label="Lessons held" />
          <Figure value={s.attendanceRate === null ? '–' : `${s.attendanceRate}%`} label="Attendance" hint={s.attendanceRate === null ? 'After the first lesson' : `${s.lessonsAttended} attended`} />
          <Figure value={s.hoursTaught} label="Hours together" />
          <Figure value={`${s.homeworkDone}/${s.homeworkDone + s.homeworkOpen}`} label="Homework done" />
        </div>
      </header>

      <section className="reveal">
        <SectionTitle eyebrow="Ahead" title="Booked" />
        {ahead.length === 0 ? (
          <Empty>Nothing booked. Schedule the next lesson, or a weekly series.</Empty>
        ) : (
          <ol className="divide-y divide-line/80 border-y border-line/80 dark:divide-night-line dark:border-night-line">
            {ahead.map((l) => (
              <li key={l.code} className="flex flex-wrap items-center gap-x-6 gap-y-2 py-5">
                <span className="w-28 font-display text-[1.6rem] leading-none tabular-nums">{fmtTime(l.at)}</span>
                <span className="min-w-0 flex-1">
                  <Link to={`/classes/${l.code}`} viewTransition className="block truncate text-lg font-medium decoration-brand-400/60 underline-offset-4 hover:underline">
                    {l.title}
                  </Link>
                  <span className="text-[13px] text-ink-2 dark:text-slate-400">
                    {fmtDay(l.at)} · {l.durationMinutes} minutes · {l.status === 'live' ? 'in session' : countdown(new Date(l.at) - now)}
                  </span>
                </span>
                <Button size="sm" onClick={() => navigate(`/m/${l.code}`, { viewTransition: true })}>
                  {l.status === 'live' ? 'Return to room' : 'Open room'}
                </Button>
              </li>
            ))}
          </ol>
        )}
      </section>

      <section className="reveal">
        <SectionTitle eyebrow="So far" title="Lessons" />
        {past.length === 0 ? (
          <Empty>Lessons appear here once they have taken place.</Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="text-[11px] tracking-[0.16em] text-ink-2 uppercase dark:text-slate-400">
                <tr className="border-b border-line/80 dark:border-night-line">
                  <th className="py-2.5 pr-4 font-medium">Lesson</th>
                  <th className="py-2.5 pr-4 font-medium">Came</th>
                  <th className="py-2.5 pr-4 font-medium">Notes</th>
                  <th className="py-2.5 font-medium">Homework</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line/70 dark:divide-night-line">
                {past.map((l) => (
                  <tr key={l.code}>
                    <td className="py-3.5 pr-4">
                      <Link to={`/classes/${l.code}`} viewTransition className="font-medium decoration-brand-400/60 underline-offset-4 hover:underline">
                        {l.title}
                      </Link>
                      <span className="block text-xs text-ink-2 dark:text-slate-400">
                        {fmtDay(l.at)} {l.status !== 'ended' && <StatusBadge status={l.status} />}
                      </span>
                    </td>
                    <td className="py-3.5 pr-4">
                      {l.attended ? <Check size={16} className="text-brand-600 dark:text-brand-300" aria-label="Attended" /> : <Minus size={16} className="text-ink-2/50" aria-label="Did not attend" />}
                    </td>
                    <td className="py-3.5 pr-4">
                      {l.hasLessonNotes ? (
                        <span className="inline-flex items-center gap-1.5 text-ink-2 dark:text-slate-300">
                          <NotebookPen size={14} strokeWidth={1.5} /> Written
                        </span>
                      ) : l.status === 'ended' ? (
                        <Link to={`/classes/${l.code}`} viewTransition className="text-brand-600 underline-offset-4 hover:underline dark:text-brand-300">
                          Write notes
                        </Link>
                      ) : (
                        <span className="text-ink-2/60">–</span>
                      )}
                    </td>
                    <td className="py-3.5">
                      {l.homeworkTotal ? (
                        <span className="inline-flex items-center gap-1.5 tabular-nums">
                          <BookOpenCheck size={14} strokeWidth={1.5} className="text-brand-600 dark:text-brand-300" /> {l.homeworkTotal - l.homeworkOpen}/{l.homeworkTotal}
                        </span>
                      ) : (
                        <span className="text-ink-2/60">–</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <ScheduleModal
        open={scheduling}
        initialInvitee={s.email}
        onClose={() => setScheduling(false)}
        onSaved={(m, series) => {
          setScheduling(false);
          load();
          toast(scheduledMessage(m, series), { tone: 'success' });
        }}
      />
    </div>
  );
}
