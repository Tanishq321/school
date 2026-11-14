import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ChevronLeft, ChevronRight, CircleDot, EyeOff, Lock, MoreHorizontal, Radio, Search, ShieldCheck } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext.jsx';
import { useToast } from '../contexts/ToastContext.jsx';
import { api } from '../services/api.js';
import { Alert, Avatar, Button } from '../components/ui/index.jsx';
import { Rosette } from '../components/brand/Guilloche.jsx';
import { fmtDuration } from '../utils/format.js';

const Eyebrow = ({ children }) => <p className="text-[11px] font-medium tracking-[0.26em] text-brand-600 uppercase dark:text-brand-300/80">{children}</p>;
const fmtDT = (d) => (d ? new Date(d).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }) : '—');

function useAdmin(path) {
  const [state, setState] = useState({ loading: true });
  const load = useCallback(() => {
    api(path)
      .then((data) => setState({ data }))
      .catch((err) => setState({ error: err.message }));
  }, [path]);
  useEffect(() => {
    setState((s) => ({ ...s, loading: true }));
    load();
  }, [load]);
  return { ...state, reload: load };
}

function Header({ title, children }) {
  return (
    <header className="flex flex-wrap items-end justify-between gap-6">
      <div>
        <Eyebrow>Administration</Eyebrow>
        <h1 className="mt-3 font-display text-[3rem] leading-none font-normal sm:text-[3.6rem]">{title}</h1>
      </div>
      {children}
    </header>
  );
}

const Skeleton = ({ rows = 6 }) => (
  <div className="space-y-3" aria-busy="true">
    {Array.from({ length: rows }, (_, i) => (
      <div key={i} className="skeleton h-12" style={{ animationDelay: `${i * 80}ms` }} />
    ))}
  </div>
);

/** Fourteen days as slim brass bars; the tallest day is labelled. */
function Bars({ data, label }) {
  const max = Math.max(1, ...data.map((d) => d.n));
  const total = data.reduce((a, d) => a + d.n, 0);
  return (
    <figure>
      <figcaption className="flex items-baseline justify-between">
        <span className="text-sm text-ink-2 dark:text-slate-400">{label}</span>
        <span className="font-display text-2xl tabular-nums">{total}</span>
      </figcaption>
      <div className="mt-3 flex h-20 items-end gap-[5px]" role="img" aria-label={`${label}: ${total} in the last 14 days`}>
        {data.map((d) => (
          <div key={d.day} className="group relative flex-1" title={`${new Date(d.day).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}: ${d.n}`}>
            <div
              className="w-full rounded-t-[3px] bg-[linear-gradient(180deg,#d8be8c,#8d6c3b)] opacity-80 transition group-hover:opacity-100"
              style={{ height: `${Math.max(d.n ? 8 : 2, (d.n / max) * 80)}px`, opacity: d.n ? undefined : 0.25 }}
            />
          </div>
        ))}
      </div>
      <div className="mt-1.5 flex justify-between text-[10px] tracking-wider text-ink-2/70 uppercase dark:text-slate-500">
        <span>{new Date(data[0].day).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}</span>
        <span>Today</span>
      </div>
    </figure>
  );
}

function Figure({ label, value, note }) {
  return (
    <div className="plate p-5">
      <p className="text-[11px] tracking-[0.2em] text-ink-2 uppercase dark:text-slate-400">{label}</p>
      <p className="mt-2 font-display text-[2.6rem] leading-none tabular-nums">{value}</p>
      {note && <p className="mt-2 text-xs text-ink-2 dark:text-slate-400">{note}</p>}
    </div>
  );
}

const Dot = ({ ok }) => <span className={`inline-block size-2 rounded-full ${ok ? 'bg-emerald-400' : 'bg-danger'}`} />;

export function AdminOverview() {
  const { user } = useAuth();
  const { data, error, reload } = useAdmin('/admin/overview');
  useEffect(() => {
    const t = setInterval(reload, 15_000);
    return () => clearInterval(t);
  }, [reload]);
  if (error) return <Alert>{error}</Alert>;
  const s = data?.system;
  return (
    <div className="space-y-12">
      <Header title="The house" />
      {!user.twoFactor?.enabled && (
        <Alert tone="info">
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
            Administrator accounts should use two-step sign-in.
            <Link to="/profile" className="font-semibold underline underline-offset-2">
              Turn it on
            </Link>
          </span>
        </Alert>
      )}
      {!data ? (
        <Skeleton rows={5} />
      ) : (
        <>
          <section className="lamplight elevated relative overflow-hidden rounded-[28px] p-8 text-hi sm:p-10" data-testid="admin-live">
            <Rosette size={440} dense className="pointer-events-none absolute -top-56 -right-36 opacity-[0.22]" />
            <div className="relative flex flex-wrap items-end gap-x-14 gap-y-6">
              <div>
                <p className="flex items-center gap-2 text-[11px] font-medium tracking-[0.28em] text-brass uppercase">
                  <Radio size={13} className={data.live.length ? 'animate-pulse text-danger dark:text-[#f0a49c]' : ''} /> In session now
                </p>
                <p className="mt-3 font-display text-[4.6rem] leading-none tabular-nums">{data.live.length}</p>
              </div>
              <div className="flex gap-10 pb-2 text-sm text-hi/60">
                <span>
                  <b className="block font-display text-2xl font-normal text-hi tabular-nums">{s.participants}</b> people in rooms
                </span>
                <span>
                  <b className="block font-display text-2xl font-normal text-hi tabular-nums">{data.classes.upcoming}</b> scheduled ahead
                </span>
                <span>
                  <b className="block font-display text-2xl font-normal text-hi tabular-nums">{s.recordingNow}</b> recording
                </span>
              </div>
            </div>
            {data.live.length > 0 && (
              <ul className="relative mt-8 divide-y divide-hi/10 border-t border-hi/10">
                {data.live.map((c) => (
                  <li key={c.id} className="flex flex-wrap items-center gap-x-6 gap-y-1 py-3.5 text-sm">
                    <span className="min-w-[10rem] flex-1 font-medium">{c.teacher || 'Teacher not in the room'}</span>
                    <span className="text-hi/60">{c.people === 2 ? 'with their student' : 'waiting for the student'}</span>
                    {c.recording && (
                      <span className="inline-flex items-center gap-1.5 text-[#f3b1aa]">
                        <CircleDot size={13} /> recording
                      </span>
                    )}
                    <span className="text-hi/60 tabular-nums">{fmtDuration((Date.now() - new Date(c.since)) / 1000)}</span>
                    <EndClass id={c.id} onDone={reload} dark />
                  </li>
                ))}
              </ul>
            )}
            <p className="relative mt-6 flex items-center gap-2 text-xs text-hi/45">
              <EyeOff size={13} strokeWidth={1.5} /> Administrators see that a class is in session, never what is said, written or recorded in it.
            </p>
          </section>

          <section className="reveal-stagger grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <Figure label="Teachers" value={data.people.teachers} />
            <Figure label="Students" value={data.people.students} note={data.people.suspended ? `${data.people.suspended} suspended account${data.people.suspended > 1 ? 's' : ''}` : undefined} />
            <Figure label="Classes held" value={data.classes.held} note={`${data.classes.hoursTaught7d} hours taught this week`} />
            <Figure
              label="Recordings"
              value={data.recordings.count}
              note={data.recordings.enabled ? `${(data.recordings.bytes / 1073741824).toFixed(2)} GB · kept ${data.recordings.retentionDays} days` : 'Recording is switched off'}
            />
          </section>

          <section className="reveal grid gap-10 lg:grid-cols-2">
            <div className="plate p-6">
              <Bars data={data.series.classes} label="Classes held, last 14 days" />
            </div>
            <div className="plate p-6">
              <Bars data={data.series.signups} label="New members, last 14 days" />
            </div>
          </section>

          <section className="reveal grid gap-10 lg:grid-cols-[1fr_1fr]">
            <div>
              <Eyebrow>Machinery</Eyebrow>
              <h2 className="mt-1.5 mb-5 font-display text-[1.9rem] leading-none font-normal">System</h2>
              <dl className="divide-y divide-line/80 border-y border-line/80 text-sm dark:divide-night-line dark:border-night-line" data-testid="admin-system">
                {[
                  ['Database', <><Dot ok={s.db === 'up'} /> {s.db === 'up' ? 'Connected' : 'Down'}</>],
                  ['Media', s.mediaMode === 'sfu' ? <><Dot ok={s.mediaWorkers.some((w) => !w.closed)} /> Media server · {s.mediaWorkers.filter((w) => !w.closed).length} worker{s.mediaWorkers.length === 1 ? '' : 's'}</> : <><Dot ok /> Browser-to-browser (no media server on this host)</>],
                  ['Relay (TURN)', <><Dot ok={s.turnConfigured} /> {s.turnConfigured ? 'Configured' : 'Not configured: calls can fail on strict networks'}</>],
                  ['Email', <><Dot ok={s.smtpConfigured} /> {s.smtpConfigured ? 'Configured' : 'Not configured: emails are only written to the log'}</>],
                  ['Response time', `${s.avgResponseMs} ms average · ${s.requests.toLocaleString()} requests · ${s.serverErrors} server errors`],
                  ['Memory', `${s.memoryRssMb} MB · event loop p99 ${s.eventLoopP99Ms} ms`],
                  ...(s.disk ? [['Recording disk', `${(s.disk.freeMb / 1024).toFixed(1)} GB free of ${(s.disk.totalMb / 1024).toFixed(0)} GB`]] : []),
                  ['Uptime', `${fmtDuration(s.uptimeSec)} · Node ${s.node}`],
                ].map(([k, v]) => (
                  <div key={k} className="flex items-center justify-between gap-6 py-3">
                    <dt className="text-ink-2 dark:text-slate-400">{k}</dt>
                    <dd className="flex items-center gap-2 text-right">{v}</dd>
                  </div>
                ))}
              </dl>
            </div>
            <div>
              <Eyebrow>Vigilance</Eyebrow>
              <h2 className="mt-1.5 mb-5 font-display text-[1.9rem] leading-none font-normal">Security</h2>
              <div className="grid grid-cols-2 gap-4">
                <Figure label="Failed sign-ins, 24 h" value={data.security.failedSignIns24h} />
                <Figure label="Two-step members" value={data.people.twoFactor} note={`of ${data.people.teachers + data.people.students + data.people.admins}`} />
              </div>
              <Link to="/admin/audit" className="mt-5 inline-flex items-center gap-2 text-sm text-brand-600 underline-offset-4 hover:underline dark:text-brand-300" viewTransition>
                <ShieldCheck size={15} strokeWidth={1.5} /> Open the audit trail
              </Link>
            </div>
          </section>
        </>
      )}
    </div>
  );
}

function EndClass({ id, onDone, dark }) {
  const toast = useToast();
  const end = async () => {
    if (!window.confirm('End this class for the teacher and student?')) return;
    try {
      await api(`/admin/classes/${id}/end`, { method: 'POST' });
      toast('Class ended');
      onDone();
    } catch (err) {
      toast(err.message, { tone: 'error' });
    }
  };
  return (
    <button onClick={end} className={`rounded-full border px-3 py-1 text-xs transition hover:border-danger hover:text-[#f3b1aa] ${dark ? 'border-hi/15 text-hi/70' : 'border-line text-ink-2 dark:border-night-line dark:text-slate-300'}`}>
      End class
    </button>
  );
}

function Pager({ page, pages, total, onPage, noun }) {
  return (
    <div className="flex items-center justify-between pt-4 text-sm text-ink-2 dark:text-slate-400">
      <span>
        {total.toLocaleString()} {noun}
      </span>
      <span className="flex items-center gap-2">
        <button disabled={page <= 1} onClick={() => onPage(page - 1)} className="rounded-full p-1.5 hover:bg-paper-2 disabled:opacity-30 dark:hover:bg-night-3" aria-label="Previous page">
          <ChevronLeft size={16} />
        </button>
        <span className="tabular-nums">
          {page} / {pages}
        </span>
        <button disabled={page >= pages} onClick={() => onPage(page + 1)} className="rounded-full p-1.5 hover:bg-paper-2 disabled:opacity-30 dark:hover:bg-night-3" aria-label="Next page">
          <ChevronRight size={16} />
        </button>
      </span>
    </div>
  );
}

const Pills = ({ value, onChange, options }) => (
  <div className="flex rounded-full border border-line bg-white/60 p-1 dark:border-night-line dark:bg-night-2/60">
    {options.map(([v, label]) => (
      <button key={v} onClick={() => onChange(v)} aria-pressed={value === v} className={`rounded-full px-3.5 py-1.5 text-sm transition ${value === v ? 'bg-ink text-vellum dark:bg-vellum dark:text-night' : 'text-ink-2 hover:text-ink dark:text-slate-400 dark:hover:text-vellum'}`}>
        {label}
      </button>
    ))}
  </div>
);

function UserMenu({ u, self, onChanged }) {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const act = async (label, fn, confirm) => {
    setOpen(false);
    if (confirm && !window.confirm(confirm)) return;
    try {
      await fn();
      toast(label, { tone: 'success' });
      onChanged();
    } catch (err) {
      toast(err.message, { tone: 'error' });
    }
  };
  const patch = (body) => api(`/admin/users/${u.id}`, { method: 'PATCH', body });
  const item = 'block w-full px-4 py-2.5 text-left hover:bg-paper-2 dark:hover:bg-night-3';
  return (
    <div className="relative">
      <button onClick={() => setOpen((v) => !v)} onBlur={() => setTimeout(() => setOpen(false), 150)} className="rounded-full p-1.5 text-ink-2 hover:bg-paper-2 dark:text-slate-300 dark:hover:bg-night-3" aria-label={`Actions for ${u.name}`} aria-haspopup="menu">
        <MoreHorizontal size={17} strokeWidth={1.6} />
      </button>
      {open && (
        <div role="menu" className="absolute right-0 z-20 mt-1 w-60 overflow-hidden rounded-2xl border border-line bg-paper py-1 text-sm shadow-2xl dark:border-night-line dark:bg-night-2">
          {u.locked && (
            <button role="menuitem" className={item} onMouseDown={() => act('Unlocked', () => patch({ unlock: true }))}>
              Unlock sign-in
            </button>
          )}
          <button role="menuitem" className={item} onMouseDown={() => act('Signed out everywhere', () => api(`/admin/users/${u.id}/sign-out`, { method: 'POST' }))}>
            Sign out of all devices
          </button>
          {!self &&
            ['teacher', 'student', 'admin']
              .filter((r) => r !== u.role)
              .map((r) => (
                <button key={r} role="menuitem" className={item} onMouseDown={() => act(`Now ${r === 'admin' ? 'an administrator' : `a ${r}`}`, () => patch({ role: r }), `Make ${u.name} ${r === 'admin' ? 'an administrator' : `a ${r}`}? They will be signed out.`)}>
                  Make {r === 'admin' ? 'administrator' : r}
                </button>
              ))}
          {!self &&
            (u.status === 'active' ? (
              <button role="menuitem" className={`${item} text-danger dark:text-red-300`} onMouseDown={() => act('Suspended', () => patch({ status: 'suspended' }), `Suspend ${u.name}? They are signed out at once and cannot sign in.`)}>
                Suspend account
              </button>
            ) : (
              <button role="menuitem" className={item} onMouseDown={() => act('Restored', () => patch({ status: 'active' }))}>
                Restore account
              </button>
            ))}
        </div>
      )}
    </div>
  );
}

export function AdminPeople() {
  const { user } = useAuth();
  const [q, setQ] = useState('');
  const [term, setTerm] = useState('');
  const [role, setRole] = useState('');
  const [page, setPage] = useState(1);
  useEffect(() => {
    const t = setTimeout(() => {
      setTerm(q.trim());
      setPage(1);
    }, 250);
    return () => clearTimeout(t);
  }, [q]);
  const { data, error, reload } = useAdmin(`/admin/users?page=${page}${term ? `&q=${encodeURIComponent(term)}` : ''}${role ? `&role=${role}` : ''}`);
  return (
    <div className="space-y-8">
      <Header title="People" />
      <div className="flex flex-wrap items-center gap-3">
        <label className="relative block w-full max-w-sm">
          <Search size={16} strokeWidth={1.5} className="absolute top-1/2 left-3.5 -translate-y-1/2 text-ink-2 dark:text-slate-400" />
          <input className="input pl-10" placeholder="Search by name or email" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search people" />
        </label>
        <Pills value={role} onChange={(v) => (setRole(v), setPage(1))} options={[['', 'Everyone'], ['teacher', 'Teachers'], ['student', 'Students'], ['admin', 'Administrators']]} />
      </div>
      {error ? (
        <Alert>{error}</Alert>
      ) : !data ? (
        <Skeleton />
      ) : (
        <>
          <ul className="divide-y divide-line/80 border-y border-line/80 dark:divide-night-line dark:border-night-line" data-testid="admin-people">
            {data.users.length === 0 && <li className="py-10 text-ink-2 dark:text-slate-400">Nobody matches.</li>}
            {data.users.map((u) => (
              <li key={u.id} className={`flex items-center gap-4 py-3.5 ${u.status === 'suspended' ? 'opacity-60' : ''}`} data-user={u.email}>
                <Avatar name={u.name} size={38} />
                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-center gap-2 font-medium">
                    <span className="truncate">{u.name}</span>
                    {u.id === user.id && <span className="text-xs font-normal text-ink-2 dark:text-slate-400">(you)</span>}
                    {u.status === 'suspended' && <span className="rounded-full bg-danger/12 px-2 py-0.5 text-[11px] font-normal text-danger dark:text-red-300">Suspended</span>}
                    {u.locked && (
                      <span className="inline-flex items-center gap-1 rounded-full bg-brand-400/15 px-2 py-0.5 text-[11px] font-normal text-brand-700 dark:text-brand-300">
                        <Lock size={10} /> Locked
                      </span>
                    )}
                  </p>
                  <p className="truncate text-xs text-ink-2 dark:text-slate-400">
                    {u.email}
                    {!u.emailVerified && ' · unverified'}
                  </p>
                </div>
                <span className="hidden w-28 text-sm capitalize sm:block">{u.role === 'admin' ? 'Administrator' : u.role}</span>
                <span className="hidden w-10 justify-center md:flex" title={u.twoFactor ? 'Two-step sign-in on' : 'Two-step sign-in off'}>
                  <ShieldCheck size={16} strokeWidth={1.5} className={u.twoFactor ? 'text-brand-500 dark:text-brand-300' : 'text-ink-2/30 dark:text-slate-600'} />
                </span>
                <span className="hidden w-36 text-right text-xs text-ink-2 lg:block dark:text-slate-400">{u.lastLoginAt ? `Last seen ${fmtDT(u.lastLoginAt)}` : 'Never signed in'}</span>
                <UserMenu u={u} self={u.id === user.id} onChanged={reload} />
              </li>
            ))}
          </ul>
          <Pager page={data.page} pages={data.pages} total={data.total} onPage={setPage} noun="people" />
        </>
      )}
    </div>
  );
}

export function AdminClasses() {
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const { data, error, reload } = useAdmin(`/admin/classes?page=${page}${status ? `&status=${status}` : ''}`);
  return (
    <div className="space-y-8">
      <Header title="Classes">
        <Pills value={status} onChange={(v) => (setStatus(v), setPage(1))} options={[['', 'All'], ['live', 'In session'], ['scheduled', 'Scheduled'], ['ended', 'Held']]} />
      </Header>
      <p className="flex max-w-2xl items-start gap-2.5 text-sm text-ink-2 dark:text-slate-400">
        <EyeOff size={16} strokeWidth={1.5} className="mt-0.5 shrink-0 text-brand-500" />
        The register shows who taught, when, and for how long. Titles, chat, notes, the board and recordings belong to the teacher and student and are not shown here.
      </p>
      {error ? (
        <Alert>{error}</Alert>
      ) : !data ? (
        <Skeleton />
      ) : (
        <>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm" data-testid="admin-classes">
              <thead className="text-[11px] tracking-[0.16em] text-ink-2 uppercase dark:text-slate-400">
                <tr className="border-b border-line/80 dark:border-night-line">
                  <th className="py-2.5 pr-4 font-medium">Teacher</th>
                  <th className="py-2.5 pr-4 font-medium">When</th>
                  <th className="py-2.5 pr-4 font-medium">Length</th>
                  <th className="py-2.5 pr-4 font-medium">Student</th>
                  <th className="py-2.5 pr-4 font-medium">Recorded</th>
                  <th className="py-2.5 font-medium">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line/70 dark:divide-night-line">
                {data.classes.length === 0 && (
                  <tr>
                    <td colSpan={6} className="py-10 text-ink-2 dark:text-slate-400">
                      No classes.
                    </td>
                  </tr>
                )}
                {data.classes.map((c) => (
                  <tr key={c.id}>
                    <td className="py-3 pr-4">
                      <span className="block font-medium">{c.teacher?.name ?? '—'}</span>
                      <span className="block text-xs text-ink-2 dark:text-slate-400">{c.teacher?.email}</span>
                    </td>
                    <td className="py-3 pr-4 tabular-nums">{fmtDT(c.startedAt || c.scheduledStart)}</td>
                    <td className="py-3 pr-4 tabular-nums">{c.startedAt && c.endedAt ? fmtDuration((new Date(c.endedAt) - new Date(c.startedAt)) / 1000) : `${c.durationMinutes} min planned`}</td>
                    <td className="py-3 pr-4">{c.attended ? 'Attended' : c.status === 'ended' ? 'Did not attend' : '—'}</td>
                    <td className="py-3 pr-4">{c.recordings ? 'Yes' : '—'}</td>
                    <td className="py-3">
                      <span className="flex items-center gap-3">
                        <span className={`capitalize ${c.status === 'live' ? 'text-danger dark:text-red-300' : ''}`}>{c.status === 'live' ? 'In session' : c.status === 'ended' ? 'Held' : c.status}</span>
                        {c.status === 'live' && <EndClass id={c.id} onDone={reload} />}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pager page={data.page} pages={data.pages} total={data.total} onPage={setPage} noun="classes" />
        </>
      )}
    </div>
  );
}

const ACTION_LABEL = {
  'auth.login': 'Signed in',
  'auth.login_failed': 'Failed sign-in',
  'auth.2fa_failed': 'Wrong two-step code',
  'auth.account_locked': 'Account locked',
  'auth.register': 'Joined',
  'auth.2fa_enabled': 'Turned on two-step sign-in',
  'auth.2fa_disabled': 'Turned off two-step sign-in',
  'auth.2fa_recovery_used': 'Used a recovery code',
  'auth.password_changed': 'Changed password',
  'auth.password_reset': 'Reset password',
  'auth.refresh_reuse_detected': 'Possible stolen session',
  'admin.user_update': 'Administrator changed an account',
  'admin.user_sign_out': 'Administrator signed someone out',
  'admin.class_end': 'Administrator ended a class',
  'meeting.create': 'Scheduled a class',
  'meeting.start': 'Started a class',
  'meeting.end': 'Class ended',
  'meeting.remove': 'Removed the student',
  'recording.start': 'Started recording',
  'recording.stop': 'Stopped recording',
  'recording.delete': 'Deleted a recording',
  'recording.view': 'Watched a recording',
};
const ALARM = new Set(['auth.login_failed', 'auth.2fa_failed', 'auth.account_locked', 'auth.refresh_reuse_detected', 'auth.2fa_disabled']);

export function AdminAudit() {
  const [filter, setFilter] = useState('');
  const [page, setPage] = useState(1);
  const { data, error } = useAdmin(`/admin/audit?page=${page}${filter ? `&action=${filter}` : ''}`);
  return (
    <div className="space-y-8">
      <Header title="Audit trail">
        <Pills value={filter} onChange={(v) => (setFilter(v), setPage(1))} options={[['', 'Everything'], ['auth.', 'Sign-ins'], ['admin.', 'Administrators'], ['meeting.', 'Classes'], ['recording.', 'Recordings']]} />
      </Header>
      {error ? (
        <Alert>{error}</Alert>
      ) : !data ? (
        <Skeleton rows={8} />
      ) : (
        <>
          <ol className="divide-y divide-line/80 border-y border-line/80 dark:divide-night-line dark:border-night-line" data-testid="admin-audit">
            {data.logs.length === 0 && <li className="py-10 text-ink-2 dark:text-slate-400">Nothing recorded.</li>}
            {data.logs.map((l) => (
              <li key={l.id} className="grid grid-cols-[8.5rem_1fr] items-baseline gap-x-5 py-3 text-sm sm:grid-cols-[8.5rem_1fr_auto]">
                <time className="text-xs text-ink-2 tabular-nums dark:text-slate-400">{fmtDT(l.at)}</time>
                <span className="min-w-0">
                  <span className={ALARM.has(l.action) ? 'text-danger dark:text-red-300' : ''}>{ACTION_LABEL[l.action] || l.action}</span>
                  <span className="text-ink-2 dark:text-slate-400">
                    {' '}
                    · {l.actor ? l.actor.name : l.meta?.email || 'someone'}
                    {l.meta && Object.keys(l.meta).filter((k) => k !== 'email').length > 0 && (
                      <span className="ml-1 font-mono text-[11px] opacity-70">
                        {Object.entries(l.meta)
                          .filter(([k]) => k !== 'email')
                          .map(([k, v]) => `${k}=${typeof v === 'object' ? JSON.stringify(v) : v}`)
                          .join(' ')
                          .slice(0, 80)}
                      </span>
                    )}
                  </span>
                </span>
                <span className="col-start-2 font-mono text-[11px] text-ink-2/70 sm:col-start-3 dark:text-slate-500">{l.ip || ''}</span>
              </li>
            ))}
          </ol>
          <Pager page={data.page} pages={data.pages} total={data.total} onPage={setPage} noun="entries" />
        </>
      )}
    </div>
  );
}

