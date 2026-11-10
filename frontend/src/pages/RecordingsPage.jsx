import { useEffect, useMemo, useState } from 'react';
import { ShieldCheck } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext.jsx';
import { api } from '../services/api.js';
import { Alert, Spinner } from '../components/ui/index.jsx';
import { Empty, RecordingCard } from '../components/classes/index.jsx';

const FILTERS = [
  { id: 'all', label: 'All' },
  { id: 'mine', label: 'My classes' },
  { id: 'shared', label: 'Shared with me' },
];

/** The archive: every recording you may watch, as a wall of film stills. */
export default function RecordingsPage() {
  const { config } = useAuth();
  const [state, setState] = useState({ loading: true, items: [] });
  const [filter, setFilter] = useState('all');
  useEffect(() => {
    let timer;
    const load = () =>
      api('/recordings')
        .then(({ recordings }) => {
          setState({ loading: false, items: recordings });
          // Keep "being prepared" cards fresh until they are ready.
          if (recordings.some((r) => ['recording', 'processing'].includes(r.status))) timer = setTimeout(load, 6000);
        })
        .catch((err) => setState({ loading: false, items: [], error: err.message }));
    load();
    return () => clearTimeout(timer);
  }, []);
  const items = useMemo(() => state.items.filter((r) => (filter === 'mine' ? r.mine : filter === 'shared' ? !r.mine : true)), [state.items, filter]);
  const hasShared = state.items.some((r) => !r.mine);
  const hasMine = state.items.some((r) => r.mine);

  return (
    <div className="space-y-12">
      <header className="flex flex-wrap items-end justify-between gap-6">
        <div>
          <p className="text-[11px] font-medium tracking-[0.28em] text-brand-600 uppercase dark:text-brand-300/80">Recordings</p>
          <h1 className="mt-3 font-display text-[3rem] leading-none font-normal sm:text-[3.8rem]">The archive</h1>
        </div>
        {hasShared && hasMine && (
          <div className="flex rounded-full border border-line bg-white/60 p-1 dark:border-night-line dark:bg-night-2/60" role="tablist">
            {FILTERS.map((f) => (
              <button
                key={f.id}
                role="tab"
                aria-selected={filter === f.id}
                onClick={() => setFilter(f.id)}
                className={`rounded-full px-4 py-1.5 text-sm transition ${filter === f.id ? 'bg-ink text-vellum dark:bg-vellum dark:text-night' : 'text-ink-2 hover:text-ink dark:text-slate-400 dark:hover:text-vellum'}`}
              >
                {f.label}
              </button>
            ))}
          </div>
        )}
      </header>

      <p className="flex max-w-2xl items-start gap-2.5 text-sm leading-relaxed text-ink-2 dark:text-slate-400">
        <ShieldCheck size={17} strokeWidth={1.5} className="mt-0.5 shrink-0 text-brand-500" />
        <span>
          Classes are recorded on this server only, and only people who agreed are captured. Recordings stay private to the teacher until shared with the class
          {config.recording?.retentionDays ? `, and are removed after ${config.recording.retentionDays} days` : ''}.
        </span>
      </p>

      {state.loading ? (
        <Spinner />
      ) : state.error ? (
        <Alert>{state.error}</Alert>
      ) : items.length === 0 ? (
        <Empty>
          {config.recording?.enabled === false && !state.items.length
            ? 'Recording is not enabled on this server. Your administrator can turn it on.'
            : 'Recordings appear here after a class is recorded.'}
        </Empty>
      ) : (
        <div className="grid gap-x-7 gap-y-10 sm:grid-cols-2 xl:grid-cols-3">
          {items.map((r) => (
            <RecordingCard key={r.id} rec={r} />
          ))}
        </div>
      )}
    </div>
  );
}
