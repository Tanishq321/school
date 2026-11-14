import { Link, NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { Activity, CalendarDays, Clapperboard, Library, LogOut, Moon, ScrollText, Search, ShieldCheck, Sun, Sunrise, UserRound, Users, GraduationCap } from 'lucide-react';
import CommandPalette from './CommandPalette.jsx';
import { Rosette, WaveBand } from './brand/Guilloche.jsx';
import { BRAND } from '../brand.js';
import { useAuth } from '../contexts/AuthContext.jsx';
import { useTheme } from '../contexts/ThemeContext.jsx';
import { Avatar, Logo } from './ui/index.jsx';
import LacquerCanvas from './brand/LacquerCanvas.jsx';
import Armillary from './brand/Armillary.jsx';

export function ThemeButton({ className = '' }) {
  const { theme, preference, toggle } = useTheme();
  const label = `${theme === 'dark' ? 'Dark' : 'Light'}${preference === 'system' ? ', following your device' : ''}. Switch to ${theme === 'dark' ? 'light' : 'dark'}`;
  return (
    <button onClick={toggle} className={`relative rounded-xl p-2 text-ink-2 hover:bg-paper-2 dark:text-slate-300 dark:hover:bg-night-3 ${className}`} aria-label={label} title={label}>
      {theme === 'dark' ? <Moon size={18} strokeWidth={1.5} /> : <Sun size={18} strokeWidth={1.5} />}
      {preference === 'system' && <span className="absolute right-1 bottom-1 size-1.5 rounded-full bg-brand-400" aria-hidden="true" />}
    </button>
  );
}

const NAV = [
  { to: '/', end: true, label: 'Today', short: 'Today', icon: Sunrise },
  { to: '/calendar', label: 'Calendar', short: 'Calendar', icon: CalendarDays },
  { to: '/classes', label: 'Classes', short: 'Classes', icon: Library },
  { to: '/recordings', label: 'Recordings', short: 'Films', icon: Clapperboard },
];
// Teachers keep a register of their students; the mobile bar shows the first four and "You".
const navFor = (role) =>
  role === 'teacher' || role === 'admin'
    ? [NAV[0], NAV[1], { to: '/students', label: 'Students', short: 'Students', icon: GraduationCap }, NAV[2], NAV[3]]
    : NAV;

const NAV_2 = [
  { to: '/diagnostics', label: 'Connection test', icon: Activity },
  { to: '/profile', label: 'Account', icon: UserRound },
];
const NAV_ADMIN = [
  { to: '/admin', end: true, label: 'Overview', icon: ShieldCheck },
  { to: '/admin/people', label: 'People', icon: Users },
  { to: '/admin/classes', label: 'Classes', icon: GraduationCap },
  { to: '/admin/audit', label: 'Audit trail', icon: ScrollText },
];

const railItem = ({ isActive }) =>
  `group relative flex items-center gap-3 rounded-xl px-3 py-2.5 text-[14px] transition duration-200 ${
    isActive ? 'bg-hi/[0.06] text-hi shadow-[inset_0_1px_0_rgba(255,255,255,.35)] dark:shadow-[inset_0_1px_0_rgba(255,255,255,.05)]' : 'text-hi/60 hover:bg-hi/[0.035] hover:text-hi'
  }`;

function RailLink({ item }) {
  const Icon = item.icon;
  return (
    <NavLink to={item.to} end={item.end} className={railItem} viewTransition>
      {({ isActive }) => (
        <>
          {/* brass notch on the active item */}
          <span className={`absolute top-1/2 -left-3 h-5 w-[3px] -translate-y-1/2 rounded-r-full bg-brand-400 transition ${isActive ? 'opacity-100' : 'opacity-0'}`} />
          <Icon size={17} strokeWidth={1.5} className={isActive ? 'text-brass' : 'text-hi/45 group-hover:text-hi/70'} />
          {item.label}
        </>
      )}
    </NavLink>
  );
}

/**
 * The member area. On desktop a lacquered spine (always dark, like the binding of a good book)
 * carries the navigation; on phones a tab bar sits under the thumb.
 */
export default function AppShell() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [palette, setPalette] = useState(false);
  const signOut = async () => {
    await logout();
    navigate('/login');
  };
  useEffect(() => {
    const onKey = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setPalette((v) => !v);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  const mac = /Mac|iPhone|iPad/.test(navigator.platform);
  return (
    <div className="min-h-full lg:pl-[272px]">
      <aside className="lamplight fixed inset-y-0 left-0 z-30 hidden w-[272px] flex-col overflow-x-hidden overflow-y-auto border-r border-line/80 px-5 pt-7 pb-5 text-hi lg:flex dark:border-white/5">
        <Rosette size={560} className="pointer-events-none absolute -bottom-64 -left-60 opacity-[0.2]" />
        <Link to="/" className="relative px-1" aria-label={`${BRAND.name} home`}>
          <Logo />
        </Link>
        <WaveBand className="relative mt-6 mb-5" opacity={0.55} />
        <button
          onClick={() => setPalette(true)}
          className="relative mb-5 flex h-10 w-full items-center gap-2.5 rounded-xl border border-hi/[0.09] bg-hi/[0.03] px-3 text-left text-[13px] text-hi/45 transition hover:border-brand-400/40 hover:text-hi/70"
          aria-label="Search and commands"
        >
          <Search size={15} strokeWidth={1.5} /> <span className="flex-1">Search or jump to…</span>
          <kbd className="!border-hi/10 !bg-hi/5 !text-hi/50">{mac ? '⌘K' : 'Ctrl K'}</kbd>
        </button>
        <nav className="relative space-y-1" aria-label="Main">
          {navFor(user?.role).map((item) => (
            <RailLink key={item.to} item={item} />
          ))}
        </nav>
        <p className="relative mt-8 mb-2 px-3 text-[11px] font-medium tracking-[0.22em] text-hi/40 uppercase">Studio</p>
        <nav className="relative space-y-1" aria-label="Studio">
          {NAV_2.map((item) => (
            <RailLink key={item.to} item={item} />
          ))}
        </nav>
        {user?.role === 'admin' && (
          <>
            <p className="relative mt-8 mb-2 px-3 text-[11px] font-medium tracking-[0.22em] text-hi/40 uppercase">Administration</p>
            <nav className="relative space-y-1" aria-label="Administration">
              {NAV_ADMIN.map((item) => (
                <RailLink key={item.to} item={item} />
              ))}
            </nav>
          </>
        )}
        <div className="relative mt-auto pt-8">
          {user?.role !== 'admin' && <p className="mb-5 px-1 font-display text-[13px] leading-snug text-hi/40 italic">{BRAND.etymology}</p>}
          <div className="flex items-center gap-3 rounded-2xl border border-hi/[0.08] bg-hi/[0.03] p-2.5">
            <Avatar name={user?.name} size={36} />
            <div className="min-w-0 flex-1 leading-tight">
              <p className="truncate text-sm font-medium">{user?.name}</p>
              <p className="text-xs text-hi/50 capitalize">{user?.role}</p>
            </div>
            <ThemeButton className="!text-hi/60 hover:!bg-hi/5 hover:!text-hi" />
            <button onClick={signOut} className="rounded-xl p-2 text-hi/60 hover:bg-hi/5 hover:text-hi" aria-label="Sign out" title="Sign out">
              <LogOut size={17} strokeWidth={1.5} />
            </button>
          </div>
        </div>
      </aside>

      {/* Phone / tablet header */}
      <header className="sticky top-0 z-30 flex h-14 items-center gap-2 border-b border-line/70 bg-paper/85 px-4 backdrop-blur-md lg:hidden dark:border-night-line/80 dark:bg-night/85">
        <Link to="/">
          <Logo />
        </Link>
        <div className="ml-auto flex items-center gap-1">
          <button onClick={() => setPalette(true)} className="rounded-xl p-2 text-ink-2 hover:bg-paper-2 dark:text-slate-300 dark:hover:bg-night-3" aria-label="Search and commands">
            <Search size={18} strokeWidth={1.5} />
          </button>
          {user?.role === 'admin' && (
            <Link to="/admin" className="rounded-xl p-2 text-ink-2 hover:bg-paper-2 dark:text-slate-300 dark:hover:bg-night-3" aria-label="Administration">
              <ShieldCheck size={18} strokeWidth={1.5} />
            </Link>
          )}
          <ThemeButton />
          <button onClick={signOut} className="rounded-xl p-2 text-ink-2 hover:bg-paper-2 dark:text-slate-300 dark:hover:bg-night-3" aria-label="Sign out">
            <LogOut size={18} strokeWidth={1.5} />
          </button>
        </div>
      </header>

      <main className="mx-auto w-full max-w-[1180px] px-5 pt-8 pb-28 sm:px-8 sm:pt-12 lg:px-14 lg:pb-16">
        <Outlet />
      </main>
      <CommandPalette open={palette} onClose={() => setPalette(false)} />

      <nav
        className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-5 border-t border-line/70 bg-paper/90 pb-[env(safe-area-inset-bottom)] backdrop-blur-md lg:hidden dark:border-night-line dark:bg-night/90"
        aria-label="Main"
      >
        {[...navFor(user?.role).slice(0, 4), { to: '/profile', short: 'You', icon: UserRound }].map((item) => {
          const Icon = item.icon;
          return (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              viewTransition
              className={({ isActive }) => `flex flex-col items-center gap-1 py-2.5 text-[11px] tracking-wide ${isActive ? 'text-brand-600 dark:text-brand-300' : 'text-ink-2 dark:text-slate-400'}`}
            >
              <Icon size={20} strokeWidth={1.5} />
              {item.short}
            </NavLink>
          );
        })}
      </nav>
    </div>
  );
}

export function AuthLayout({ title, subtitle, children, footer }) {
  return (
    <div className="grid min-h-full lg:grid-cols-[1.1fr_1fr]">
      <aside className="relative hidden overflow-hidden p-14 text-hi lg:flex lg:flex-col">
        <LacquerCanvas />
        <Rosette size={900} dense className="pointer-events-none absolute -right-72 -bottom-80 opacity-[0.18]" />
        <Armillary idle className="!absolute inset-x-0 top-[7%] h-[52%]" />
        <Link to="/" className="relative">
          <Logo />
        </Link>
        <div className="relative mt-auto max-w-lg">
          <div className="hairline mb-10 w-40" />
          <p className="animate-reveal font-display text-[3.4rem] leading-[1.04] font-normal">A private room for serious study.</p>
          <p className="mt-6 max-w-md text-[17px] leading-relaxed text-hi/70">
            Private one-to-one lessons, recorded only with consent, on infrastructure that answers only to you.
          </p>
          <p className="mt-10 font-display text-sm text-hi/45 italic">{BRAND.name} — {BRAND.etymology}</p>
        </div>
      </aside>
      <section className="flex flex-col px-6 py-8 sm:px-12">
        <div className="flex items-center justify-between lg:justify-end">
          <Logo className="lg:hidden" />
          <ThemeButton />
        </div>
        <div className="mx-auto my-auto w-full max-w-sm py-12">
          <h1 className="font-display text-[2.6rem] leading-tight font-normal">{title}</h1>
          {subtitle && <p className="mt-2 text-ink-2 dark:text-slate-400">{subtitle}</p>}
          <div className="mt-10">{children}</div>
          {footer && <div className="mt-10 text-center text-sm text-ink-2 dark:text-slate-400">{footer}</div>}
        </div>
      </section>
    </div>
  );
}
