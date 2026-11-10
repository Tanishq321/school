import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Activity, CalendarDays, Clapperboard, CornerDownLeft, Library, LogOut, Moon, Search, ShieldCheck, Sunrise, UserRound, Users, Video } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext.jsx';
import { useTheme } from '../contexts/ThemeContext.jsx';
import { useToast } from '../contexts/ToastContext.jsx';
import { api } from '../services/api.js';

/** ⌘K / Ctrl+K: go anywhere, open a room, find a class, without leaving the keyboard. */
export default function CommandPalette({ open, onClose }) {
  const { user, logout } = useAuth();
  const { toggle } = useTheme();
  const navigate = useNavigate();
  const toast = useToast();
  const [q, setQ] = useState('');
  const [index, setIndex] = useState(0);
  const [classes, setClasses] = useState([]);
  const inputRef = useRef(null);
  const listRef = useRef(null);
  const canHost = user.role === 'teacher' || user.role === 'admin';

  useEffect(() => {
    if (!open) return;
    setQ('');
    setIndex(0);
    inputRef.current?.focus();
    api('/meetings?scope=upcoming')
      .then(({ meetings }) => setClasses(meetings))
      .catch(() => {});
  }, [open]);

  const items = useMemo(() => {
    const go = (to) => () => navigate(to, { viewTransition: true });
    const base = [
      { group: 'Go to', label: 'Today', icon: Sunrise, run: go('/') },
      { group: 'Go to', label: 'Calendar', icon: CalendarDays, run: go('/calendar') },
      { group: 'Go to', label: 'Classes', icon: Library, run: go('/classes') },
      { group: 'Go to', label: 'Recordings', icon: Clapperboard, run: go('/recordings') },
      { group: 'Go to', label: 'Account and security', icon: UserRound, run: go('/profile'), keywords: 'profile password two-step devices' },
      { group: 'Go to', label: 'Connection test', icon: Activity, run: go('/diagnostics') },
      ...(user.role === 'admin'
        ? [
            { group: 'Administration', label: 'Overview', icon: ShieldCheck, run: go('/admin') },
            { group: 'Administration', label: 'People', icon: Users, run: go('/admin/people') },
            { group: 'Administration', label: 'Audit trail', icon: ShieldCheck, run: go('/admin/audit') },
          ]
        : []),
      ...(canHost
        ? [
            {
              group: 'Actions',
              label: 'Open a room now',
              icon: Video,
              run: async () => {
                try {
                  const { meeting } = await api('/meetings', { method: 'POST', body: { type: 'instant' } });
                  navigate(`/m/${meeting.code}`, { viewTransition: true });
                } catch (err) {
                  toast(err.message, { tone: 'error' });
                }
              },
            },
          ]
        : []),
      { group: 'Actions', label: 'Switch light / dark', icon: Moon, run: toggle, keywords: 'theme' },
      { group: 'Actions', label: 'Sign out', icon: LogOut, run: async () => (await logout(), navigate('/login')) },
      ...classes.map((m) => ({
        group: 'Upcoming classes',
        label: m.title,
        hint: new Date(m.scheduledStart).toLocaleString(undefined, { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }),
        icon: CalendarDays,
        run: go(`/classes/${m.code}`),
      })),
    ];
    const term = q.trim().toLowerCase();
    return term ? base.filter((i) => `${i.label} ${i.group} ${i.keywords || ''}`.toLowerCase().includes(term)) : base;
  }, [q, classes, user.role, canHost, navigate, toggle, logout, toast]);

  useEffect(() => setIndex(0), [q]);
  useEffect(() => {
    listRef.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [index]);

  if (!open) return null;
  const run = (item) => {
    onClose();
    item.run();
  };
  const onKey = (e) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setIndex((i) => Math.min(items.length - 1, i + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setIndex((i) => Math.max(0, i - 1));
    } else if (e.key === 'Enter' && items[index]) {
      e.preventDefault();
      run(items[index]);
    } else if (e.key === 'Escape') onClose();
  };
  let lastGroup = null;
  return (
    <div className="fixed inset-0 z-[90] flex items-start justify-center bg-black/55 px-4 pt-[14vh] backdrop-blur-sm" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div role="dialog" aria-modal="true" aria-label="Command palette" className="animate-fade-up w-full max-w-[580px] overflow-hidden rounded-[22px] border border-night-line bg-night-2/95 text-vellum shadow-[0_50px_120px_-30px_rgba(0,0,0,.95),inset_0_0_0_1px_rgba(216,190,140,.12)] backdrop-blur-xl" data-testid="command-palette">
        <div className="flex items-center gap-3 border-b border-night-line px-5">
          <Search size={17} strokeWidth={1.5} className="text-brand-300" />
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={onKey}
            placeholder="Go to a page, find a class, or run an action"
            className="h-14 flex-1 bg-transparent text-[15px] outline-none placeholder:text-slate-500"
            role="combobox"
            aria-expanded="true"
            aria-controls="cmdk-list"
          />
          <kbd className="!border-night-line !bg-night-3 !text-slate-400">esc</kbd>
        </div>
        <ul id="cmdk-list" ref={listRef} role="listbox" className="max-h-[52vh] overflow-y-auto p-2">
          {items.length === 0 && <li className="px-4 py-8 text-center text-sm text-slate-400">Nothing matches “{q}”.</li>}
          {items.map((item, i) => {
            const header = item.group !== lastGroup;
            lastGroup = item.group;
            const Icon = item.icon;
            return (
              <li key={`${item.group}-${item.label}-${i}`} role="presentation">
                {header && <p className="px-3 pt-3 pb-1.5 text-[10px] font-medium tracking-[0.24em] text-slate-500 uppercase">{item.group}</p>}
                <button
                  role="option"
                  aria-selected={i === index}
                  onMouseEnter={() => setIndex(i)}
                  onClick={() => run(item)}
                  className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-[14px] ${i === index ? 'bg-brand-400/14 text-vellum' : 'text-vellum/75'}`}
                >
                  <Icon size={16} strokeWidth={1.5} className={i === index ? 'text-brand-300' : 'text-slate-500'} />
                  <span className="min-w-0 flex-1 truncate">{item.label}</span>
                  {item.hint && <span className="shrink-0 text-xs text-slate-500">{item.hint}</span>}
                  {i === index && <CornerDownLeft size={14} className="shrink-0 text-brand-300" />}
                </button>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
