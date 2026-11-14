import { useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, Plus } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext.jsx';
import { useToast } from '../contexts/ToastContext.jsx';
import { Alert, Button, Spinner } from '../components/ui/index.jsx';
import { AgendaRow, Empty, ScheduleModal, scheduledMessage, useMeetings } from '../components/classes/index.jsx';
import { fmtTime } from '../utils/format.js';

const startOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
const sameDay = (a, b) => a.toDateString() === b.toDateString();
const WEEKDAYS = Array.from({ length: 7 }, (_, i) => new Date(2024, 0, 1 + i).toLocaleDateString(undefined, { weekday: 'short' })); // Monday first

/** Month view: the visible grid always starts on a Monday and spans whole weeks. */
function gridFor(month) {
  const first = new Date(month.getFullYear(), month.getMonth(), 1);
  const offset = (first.getDay() + 6) % 7;
  const start = addDays(first, -offset);
  const last = new Date(month.getFullYear(), month.getMonth() + 1, 0);
  const weeks = Math.ceil((offset + last.getDate()) / 7);
  return Array.from({ length: weeks * 7 }, (_, i) => addDays(start, i));
}

export default function CalendarPage() {
  const { user } = useAuth();
  const toast = useToast();
  const isHostRole = user.role === 'teacher' || user.role === 'admin';
  const [month, setMonth] = useState(() => new Date(new Date().getFullYear(), new Date().getMonth(), 1));
  const [selected, setSelected] = useState(() => startOfDay(new Date()));
  const [schedule, setSchedule] = useState(null); // initial start date for the modal
  const days = useMemo(() => gridFor(month), [month]);
  const range = useMemo(() => ({ from: days[0], to: addDays(days[days.length - 1], 1) }), [days]);
  const { meetings, loading, error, reload } = useMeetings('range', range);

  const byDay = useMemo(() => {
    const map = new Map();
    for (const m of meetings) {
      const k = startOfDay(new Date(m.scheduledStart)).toDateString();
      if (!map.has(k)) map.set(k, []);
      map.get(k).push(m);
    }
    return map;
  }, [meetings]);
  const today = startOfDay(new Date());
  const dayItems = byDay.get(selected.toDateString()) ?? [];

  const go = (delta) => setMonth(new Date(month.getFullYear(), month.getMonth() + delta, 1));
  const scheduleOn = (day) => {
    const d = new Date(day);
    if (sameDay(day, new Date())) {
      const n = new Date(Date.now() + 60 * 60_000);
      d.setHours(n.getHours(), n.getMinutes() < 30 ? 30 : 0, 0, 0);
      if (n.getMinutes() >= 30) d.setHours(d.getHours() + 1);
    } else d.setHours(10, 0, 0, 0);
    setSchedule(d);
  };
  const pastDay = selected < today;

  return (
    <div className="space-y-10">
      <header className="flex flex-wrap items-end justify-between gap-6">
        <div>
          <p className="text-[11px] font-medium tracking-[0.28em] text-brand-600 uppercase dark:text-brand-300/80">Calendar</p>
          <h1 className="mt-3 font-display text-[3rem] leading-none font-normal sm:text-[3.8rem]">
            {month.toLocaleDateString(undefined, { month: 'long' })} <span className="text-ink-2/60 italic dark:text-vellum/40">{month.getFullYear()}</span>
          </h1>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center rounded-full border border-line bg-white/60 p-1 dark:border-night-line dark:bg-night-2/60">
            <button onClick={() => go(-1)} className="rounded-full p-2 hover:bg-paper-2 dark:hover:bg-night-3" aria-label="Previous month">
              <ChevronLeft size={17} strokeWidth={1.5} />
            </button>
            <button
              onClick={() => {
                setMonth(new Date(today.getFullYear(), today.getMonth(), 1));
                setSelected(today);
              }}
              className="rounded-full px-3.5 py-1.5 text-sm hover:bg-paper-2 dark:hover:bg-night-3"
            >
              Today
            </button>
            <button onClick={() => go(1)} className="rounded-full p-2 hover:bg-paper-2 dark:hover:bg-night-3" aria-label="Next month">
              <ChevronRight size={17} strokeWidth={1.5} />
            </button>
          </div>
          {isHostRole && (
            <Button onClick={() => scheduleOn(selected < today ? today : selected)}>
              <Plus size={16} strokeWidth={1.6} /> Schedule
            </Button>
          )}
        </div>
      </header>

      {error && <Alert>{error}</Alert>}

      <div className="card overflow-hidden p-0">
        <div className="grid grid-cols-7 border-b border-line/80 dark:border-night-line">
          {WEEKDAYS.map((d) => (
            <div key={d} className="px-3 py-3 text-[11px] font-medium tracking-[0.18em] text-ink-2 uppercase dark:text-slate-400">
              {d}
            </div>
          ))}
        </div>
        <div className="relative grid grid-cols-7" role="grid" aria-label="Month">
          {loading && (
            <div className="absolute top-3 right-3 z-10">
              <Spinner size={16} />
            </div>
          )}
          {days.map((day, i) => {
            const inMonth = day.getMonth() === month.getMonth();
            const items = byDay.get(day.toDateString()) ?? [];
            const isToday = sameDay(day, today);
            const isSel = sameDay(day, selected);
            return (
              <button
                key={day.toISOString()}
                role="gridcell"
                aria-selected={isSel}
                aria-label={`${day.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' })}, ${items.length} class${items.length === 1 ? '' : 'es'}`}
                onClick={() => setSelected(day)}
                onDoubleClick={() => isHostRole && day >= today && scheduleOn(day)}
                className={`group relative flex min-h-[74px] flex-col items-stretch gap-1 border-line/70 p-1.5 text-left transition sm:min-h-[118px] sm:p-2.5 dark:border-night-line ${
                  i % 7 !== 6 ? 'border-r' : ''
                } ${i < days.length - 7 ? 'border-b' : ''} ${isSel ? 'bg-brand-400/[0.08]' : 'hover:bg-paper-2/60 dark:hover:bg-night-3/40'} ${inMonth ? '' : 'opacity-40'}`}
              >
                <span
                  className={`flex size-8 items-center justify-center self-start rounded-full font-display text-[1.05rem] tabular-nums ${
                    isToday ? 'bg-[linear-gradient(180deg,#b8955c,#86663a)] text-vellum shadow-[inset_0_1px_0_rgba(255,240,210,.35)]' : ''
                  }`}
                >
                  {day.getDate()}
                </span>
                <span className="hidden space-y-1 sm:block">
                  {items.slice(0, 3).map((m) => (
                    <span
                      key={m.code}
                      className={`block truncate rounded-md px-1.5 py-0.5 text-[12px] leading-snug ${
                        m.status === 'live'
                          ? 'bg-danger/12 text-danger dark:text-red-300'
                          : m.isHost
                            ? 'bg-brand-400/14 text-brand-700 dark:text-brand-100'
                            : 'border border-brand-400/30 text-ink-2 dark:text-vellum/80'
                      } ${['ended', 'expired'].includes(m.status) ? 'opacity-60' : ''}`}
                    >
                      <span className="tabular-nums opacity-70">{fmtTime(m.scheduledStart).replace(/\s?[AP]M$/i, '')}</span> {m.title}
                    </span>
                  ))}
                  {items.length > 3 && <span className="block px-1.5 text-[11px] text-ink-2 dark:text-slate-400">+{items.length - 3} more</span>}
                </span>
                {items.length > 0 && (
                  <span className="mt-auto flex gap-0.5 self-center sm:hidden">
                    {items.slice(0, 3).map((m) => (
                      <span key={m.code} className={`size-1.5 rounded-full ${m.status === 'live' ? 'bg-danger' : 'bg-brand-400'}`} />
                    ))}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      <section>
        <div className="mb-5 flex items-end justify-between gap-4">
          <h2 className="font-display text-[2rem] leading-none font-normal">
            {sameDay(selected, today) ? 'Today' : selected.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' })}
          </h2>
          {isHostRole && !pastDay && (
            <Button size="sm" variant="secondary" onClick={() => scheduleOn(selected)}>
              <Plus size={14} strokeWidth={1.6} /> Schedule on this day
            </Button>
          )}
        </div>
        {dayItems.length === 0 ? (
          <Empty>{pastDay ? 'No classes that day.' : 'A free day.'}</Empty>
        ) : (
          <ol className="divide-y divide-line/80 border-y border-line/80 dark:divide-night-line dark:border-night-line">
            {dayItems.map((m) => (
              <AgendaRow key={m.code} meeting={m} onChanged={reload} />
            ))}
          </ol>
        )}
      </section>

      <ScheduleModal
        open={Boolean(schedule)}
        initialStart={schedule}
        onClose={() => setSchedule(null)}
        onSaved={(m, series) => {
          setSchedule(null);
          reload();
          toast(scheduledMessage(m, series), { tone: 'success' });
        }}
      />
    </div>
  );
}
