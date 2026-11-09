import { Link, NavLink, Outlet, useNavigate } from 'react-router-dom';
import { Activity, LayoutDashboard, LogOut, Moon, Sun, UserRound } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext.jsx';
import { useTheme } from '../contexts/ThemeContext.jsx';
import { Avatar, Logo } from './ui/index.jsx';

export function ThemeButton({ className = '' }) {
  const { theme, toggle } = useTheme();
  return (
    <button onClick={toggle} className={`rounded-xl p-2 text-ink-2 hover:bg-paper-2 dark:text-stone-300 dark:hover:bg-night-3 ${className}`} aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}>
      {theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}
    </button>
  );
}

const navCls = ({ isActive }) =>
  `inline-flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-medium transition ${
    isActive ? 'bg-brand-600/10 text-brand-700 dark:bg-brand-400/10 dark:text-brand-100' : 'text-ink-2 hover:bg-paper-2 dark:text-stone-300 dark:hover:bg-night-3'
  }`;

export default function AppShell() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  return (
    <div className="flex min-h-full flex-col">
      <header className="sticky top-0 z-30 border-b border-line/70 bg-paper/85 backdrop-blur dark:border-night-line dark:bg-night/85">
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
                <span className="block text-xs capitalize text-ink-2 dark:text-stone-400">{user?.role}</span>
              </span>
            </NavLink>
            <button
              onClick={async () => {
                await logout();
                navigate('/login');
              }}
              className="rounded-xl p-2 text-ink-2 hover:bg-paper-2 dark:text-stone-300 dark:hover:bg-night-3"
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
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6 sm:px-6 sm:py-10">
        <Outlet />
      </main>
    </div>
  );
}

export function AuthLayout({ title, subtitle, children, footer }) {
  return (
    <div className="grid min-h-full lg:grid-cols-[1.05fr_1fr]">
      <aside className="relative hidden overflow-hidden bg-brand-700 p-12 text-paper lg:flex lg:flex-col">
        <div className="absolute inset-0 opacity-[0.08]" style={{ backgroundImage: 'radial-gradient(circle at 1px 1px, #fff 1px, transparent 0)', backgroundSize: '22px 22px' }} />
        <Logo className="relative [&_span]:text-paper" />
        <div className="relative mt-auto max-w-md">
          <p className="font-display text-4xl leading-tight font-medium">Teach face to face, wherever your students are.</p>
          <p className="mt-4 text-brand-100/90">Live classes on infrastructure you run yourself: no third-party video service in the middle.</p>
        </div>
        <div className="relative mt-10 flex gap-6 text-sm text-brand-100/80">
          <span>Encrypted in transit</span>
          <span>·</span>
          <span>Self-hosted</span>
          <span>·</span>
          <span>Works on mobile</span>
        </div>
      </aside>
      <section className="flex flex-col px-5 py-8 sm:px-10">
        <div className="flex items-center justify-between lg:justify-end">
          <Logo className="lg:hidden" />
          <ThemeButton />
        </div>
        <div className="mx-auto my-auto w-full max-w-sm py-10">
          <h1 className="font-display text-3xl font-semibold tracking-tight">{title}</h1>
          {subtitle && <p className="mt-2 text-ink-2 dark:text-stone-400">{subtitle}</p>}
          <div className="mt-8">{children}</div>
          {footer && <div className="mt-8 text-center text-sm text-ink-2 dark:text-stone-400">{footer}</div>}
        </div>
      </section>
    </div>
  );
}
