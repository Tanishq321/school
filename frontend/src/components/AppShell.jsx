import { Link, NavLink, Outlet, useNavigate } from 'react-router-dom';
import { Activity, LayoutDashboard, LogOut, Moon, Sun, UserRound } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext.jsx';
import { useTheme } from '../contexts/ThemeContext.jsx';
import { Avatar, Logo, Monogram } from './ui/index.jsx';

export function ThemeButton({ className = '' }) {
  const { theme, toggle } = useTheme();
  return (
    <button onClick={toggle} className={`rounded-xl p-2 text-ink-2 hover:bg-paper-2 dark:text-slate-300 dark:hover:bg-night-3 ${className}`} aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}>
      {theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}
    </button>
  );
}

const navCls = ({ isActive }) =>
  `relative inline-flex items-center gap-2 px-3 py-2 text-sm transition after:absolute after:inset-x-3 after:-bottom-[13px] after:h-px after:transition ${
    isActive
      ? 'text-ink after:bg-brand-400 dark:text-vellum'
      : 'text-ink-2 after:bg-transparent hover:text-ink dark:text-slate-400 dark:hover:text-vellum'
  }`;

export default function AppShell() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  return (
    <div className="flex min-h-full flex-col">
      <header className="sticky top-0 z-30 border-b border-line/70 bg-paper/80 backdrop-blur-md dark:border-night-line/80 dark:bg-night/80">
        <div className="mx-auto flex h-16 max-w-6xl items-center gap-2 px-4 sm:px-6">
          <Link to="/" className="mr-4">
            <Logo />
          </Link>
          <nav className="hidden items-center gap-1 sm:flex">
            <NavLink to="/" end className={navCls}>
              <LayoutDashboard size={16} /> Dashboard
            </NavLink>
            <NavLink to="/diagnostics" className={navCls}>
              <Activity size={16} /> Connection test
            </NavLink>
          </nav>
          <div className="ml-auto flex items-center gap-1">
            <ThemeButton />
            <NavLink to="/profile" className="flex items-center gap-2 rounded-xl px-2 py-1.5 hover:bg-paper-2 dark:hover:bg-night-3" aria-label="Profile">
              <Avatar name={user?.name} size={30} />
              <span className="hidden text-sm leading-tight md:block">
                <span className="block font-medium">{user?.name}</span>
                <span className="block text-xs capitalize text-ink-2 dark:text-slate-400">{user?.role}</span>
              </span>
            </NavLink>
            <button
              onClick={async () => {
                await logout();
                navigate('/login');
              }}
              className="rounded-xl p-2 text-ink-2 hover:bg-paper-2 dark:text-slate-300 dark:hover:bg-night-3"
              aria-label="Sign out"
              title="Sign out"
            >
              <LogOut size={18} />
            </button>
          </div>
        </div>
        <nav className="flex gap-1 border-t border-line/60 px-3 py-1.5 sm:hidden dark:border-night-line">
          <NavLink to="/" end className={navCls}>
            <LayoutDashboard size={16} /> Home
          </NavLink>
          <NavLink to="/diagnostics" className={navCls}>
            <Activity size={16} /> Test
          </NavLink>
          <NavLink to="/profile" className={navCls}>
            <UserRound size={16} /> Profile
          </NavLink>
        </nav>
      </header>
      <main className="mx-auto w-full max-w-6xl flex-1 px-5 py-8 sm:px-8 sm:py-14">
        <Outlet />
      </main>
    </div>
  );
}

export function AuthLayout({ title, subtitle, children, footer }) {
  return (
    <div className="grid min-h-full lg:grid-cols-[1.1fr_1fr]">
      <aside className="lamplight relative hidden overflow-hidden p-14 text-vellum lg:flex lg:flex-col">
        {/* Engraved monogram, oversized and cropped: the one ornament on the page. */}
        <Monogram size={720} className="pointer-events-none absolute -right-48 -bottom-56 opacity-[0.13]" />
        <Logo className="relative" />
        <div className="relative mt-auto max-w-lg">
          <div className="hairline mb-10 w-40" />
          <p className="animate-reveal font-display text-[3.4rem] leading-[1.04] font-normal">A private room for serious study.</p>
          <p className="mt-6 max-w-md text-[17px] leading-relaxed text-vellum/70">
            Live one-to-one and small-group classes, on infrastructure that answers only to you.
          </p>
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
