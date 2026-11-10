import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowUpRight, Search } from 'lucide-react';
import { Alert, Spinner } from '../components/ui/index.jsx';
import { Empty, StatusBadge, useMeetings } from '../components/classes/index.jsx';
import { fmtDuration, fmtTime } from '../utils/format.js';

/** The ledger of every class held: grouped by month, searchable, each opening its own page. */
export default function ClassesPage() {
  const past = useMeetings('past');
  const [q, setQ] = useState('');
  const groups = useMemo(() => {
    const term = q.trim().toLowerCase();
    const list = past.meetings.filter((m) => m.status !== 'cancelled' && (!term || m.title.toLowerCase().includes(term) || m.hostName?.toLowerCase().includes(term)));
    const map = new Map();
    for (const m of list) {
      const d = new Date(m.startedAt || m.scheduledStart);
      const key = d.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(m);
    }
    return [...map.entries()];
  }, [past.meetings, q]);
  const held = past.meetings.filter((m) => m.status === 'ended' && m.startedAt);
  const totalSec = held.reduce((s, m) => s + (m.endedAt ? (new Date(m.endedAt) - new Date(m.startedAt)) / 1000 : 0), 0);

  return (
    <div className="space-y-12">
      <header className="flex flex-wrap items-end justify-between gap-8">
        <div>
          <p className="text-[11px] font-medium tracking-[0.28em] text-brand-600 uppercase dark:text-brand-300/80">Classes</p>
          <h1 className="mt-3 font-display text-[3rem] leading-none font-normal sm:text-[3.8rem]">The ledger</h1>
        </div>
        {held.length > 0 && (
          <dl className="flex gap-10">
            <Stat label="Classes held" value={held.length} />
            <Stat label="Hours in session" value={(totalSec / 3600).toFixed(totalSec > 36000 ? 0 : 1)} />
          </dl>
        )}
      </header>

      <label className="relative block max-w-md">
        <Search size={16} strokeWidth={1.5} className="absolute top-1/2 left-3.5 -translate-y-1/2 text-ink-2 dark:text-slate-400" />
        <input className="input pl-10" placeholder="Search by title or teacher" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search classes" />
      </label>

      {past.loading ? (
        <Spinner />
      ) : past.error ? (
        <Alert>{past.error}</Alert>
      ) : groups.length === 0 ? (
        <Empty>{q ? 'No class matches that search.' : 'Classes appear here once they have been held.'}</Empty>
      ) : (
        groups.map(([month, items]) => (
          <section key={month}>
            <h2 className="mb-3 flex items-center gap-4 font-display text-xl italic text-ink-2 dark:text-vellum/60">
              {month}
              <span className="hairline flex-1" />
            </h2>
            <ol className="divide-y divide-line/80 dark:divide-night-line">
              {items.map((m) => {
                const d = new Date(m.startedAt || m.scheduledStart);
                const len = m.startedAt && m.endedAt ? fmtDuration((new Date(m.endedAt) - new Date(m.startedAt)) / 1000) : null;
                return (
                  <li key={m.code}>
                    <Link to={`/classes/${m.code}`} viewTransition className="group grid grid-cols-[3.5rem_1fr_auto] items-center gap-5 py-4 sm:grid-cols-[4.5rem_1fr_auto_auto]">
                      <span className="leading-none">
                        <span className="block font-display text-[1.9rem] tabular-nums">{d.getDate()}</span>
                        <span className="mt-1 block text-[11px] tracking-[0.16em] text-ink-2 uppercase dark:text-slate-400">{d.toLocaleDateString(undefined, { weekday: 'short' })}</span>
                      </span>
                      <span className="min-w-0">
                        <span className="block truncate text-[17px] font-medium group-hover:underline group-hover:decoration-brand-400/60 group-hover:underline-offset-4">{m.title}</span>
                        <span className="block text-[13px] text-ink-2 dark:text-slate-400">
                          {fmtTime(d)}
                          {len && ` · ${len}`}
                          {!m.isHost && m.hostName && ` · with ${m.hostName}`}
                        </span>
                      </span>
                      <span className="hidden sm:block">{m.status !== 'ended' && <StatusBadge status={m.status} />}</span>
                      <ArrowUpRight size={18} strokeWidth={1.4} className="text-ink-2/50 transition group-hover:translate-x-0.5 group-hover:-translate-y-0.5 group-hover:text-brand-500" />
                    </Link>
                  </li>
                );
              })}
            </ol>
          </section>
        ))
      )}
    </div>
  );
}

function Stat({ label, value }) {
  return (
    <div>
      <dt className="text-[11px] tracking-[0.2em] text-ink-2 uppercase dark:text-slate-400">{label}</dt>
      <dd className="mt-1 font-display text-[2.4rem] leading-none tabular-nums">{value}</dd>
    </div>
  );
}
