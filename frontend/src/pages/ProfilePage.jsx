import { useCallback, useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { Check, Copy, Download, KeyRound, Laptop, LogOut, Monitor, Moon, ShieldCheck, Smartphone, Sun } from 'lucide-react';
import { useTheme } from '../contexts/ThemeContext.jsx';
import { useAuth } from '../contexts/AuthContext.jsx';
import { useToast } from '../contexts/ToastContext.jsx';
import { api, sessionBody, setSession } from '../services/api.js';
import { Alert, Button, Field, Modal, Spinner } from '../components/ui/index.jsx';
import MemberCard from '../components/brand/MemberCard.jsx';
import { WaveBand } from '../components/brand/Guilloche.jsx';
import { BRAND } from '../brand.js';
import { copyText } from '../utils/format.js';

const Eyebrow = ({ children }) => <p className="text-[11px] font-medium tracking-[0.26em] text-brand-600 uppercase dark:text-brand-300/80">{children}</p>;

export default function ProfilePage() {
  const { user } = useAuth();
  // Links such as /profile#two-step land on that section.
  useEffect(() => {
    const id = window.location.hash.slice(1);
    if (id) requestAnimationFrame(() => document.getElementById(id)?.scrollIntoView({ block: 'start' }));
  }, []);
  return (
    <div className="space-y-14">
      <header>
        <Eyebrow>Account</Eyebrow>
        <h1 className="mt-3 font-display text-[3rem] leading-none font-normal sm:text-[3.8rem]">Your membership</h1>
      </header>
      <div className="grid items-start gap-12 lg:grid-cols-[minmax(0,430px)_1fr]">
        <div className="lg:sticky lg:top-10">
          <MemberCard user={user} />
          <p className="mt-5 text-center text-xs text-ink-2 dark:text-slate-400">
            {user.email} {user.emailVerified ? '· verified' : '· not yet verified'}
          </p>
        </div>
        <div className="min-w-0 space-y-14">
          <Details />
          <Appearance />
          <WaveBand />
          <TwoStep />
          <Password />
          <Devices />
        </div>
      </div>
    </div>
  );
}

function Section({ eyebrow, title, children, aside, id }) {
  return (
    <section id={id} className="scroll-mt-10">
      <div className="mb-5 flex items-end justify-between gap-4">
        <div>
          <Eyebrow>{eyebrow}</Eyebrow>
          <h2 className="mt-1.5 font-display text-[1.9rem] leading-none font-normal">{title}</h2>
        </div>
        {aside}
      </div>
      {children}
    </section>
  );
}

function Details() {
  const { user, setUser } = useAuth();
  const toast = useToast();
  const isTeacher = user.role === 'teacher';
  const profile = (isTeacher ? user.teacherProfile : user.studentProfile) || {};
  const [form, setForm] = useState({ name: user.name, bio: profile.bio || '', subjects: (profile.subjects || []).join(', '), gradeLevel: profile.gradeLevel || '' });
  const [state, setState] = useState({});
  const save = async (e) => {
    e.preventDefault();
    setState({ loading: true });
    const p = { bio: form.bio };
    if (isTeacher) p.subjects = form.subjects.split(',').map((s) => s.trim()).filter(Boolean);
    if (user.role === 'student') p.gradeLevel = form.gradeLevel;
    try {
      const { user: u } = await api('/auth/me', { method: 'PATCH', body: { name: form.name.trim(), ...(user.role !== 'admin' ? { profile: p } : {}) } });
      setUser(u);
      setState({});
      toast('Saved', { tone: 'success' });
    } catch (err) {
      setState({ error: err.message });
    }
  };
  return (
    <Section eyebrow="Profile" title="Details">
      <form onSubmit={save} className="space-y-4">
        {state.error && <Alert>{state.error}</Alert>}
        <Field label="Name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} maxLength={80} required />
        {user.role !== 'admin' && (
          <div>
            <label className="label" htmlFor="bio">
              About
            </label>
            <textarea id="bio" className="input min-h-24" maxLength={1000} value={form.bio} onChange={(e) => setForm({ ...form, bio: e.target.value })} />
          </div>
        )}
        {isTeacher && <Field label="Subjects" hint="Comma separated" value={form.subjects} onChange={(e) => setForm({ ...form, subjects: e.target.value })} />}
        {user.role === 'student' && <Field label="Level" value={form.gradeLevel} onChange={(e) => setForm({ ...form, gradeLevel: e.target.value })} maxLength={50} />}
        <div className="flex justify-end">
          <Button type="submit" loading={state.loading}>
            Save
          </Button>
        </div>
      </form>
    </Section>
  );
}

/** Follow the device (light by day, dark at night, if the device switches), or fix one. */
function Appearance() {
  const { preference, theme, setPreference } = useTheme();
  const options = [
    { id: 'system', label: 'Follow device', icon: Monitor },
    { id: 'light', label: 'Light', icon: Sun },
    { id: 'dark', label: 'Dark', icon: Moon },
  ];
  return (
    <Section eyebrow="Appearance" title="Light and dark">
      <div className="grid grid-cols-3 gap-3" role="radiogroup" aria-label="Appearance" data-testid="appearance">
        {options.map((o) => {
          const Icon = o.icon;
          const on = preference === o.id;
          return (
            <button
              key={o.id}
              role="radio"
              aria-checked={on}
              onClick={() => setPreference(o.id)}
              className={`group flex flex-col items-start gap-3 rounded-[16px] border p-4 text-left transition ${
                on ? 'border-brand-400/70 bg-brand-400/[0.08] shadow-[inset_0_0_0_1px_rgba(198,162,106,.35)]' : 'border-line/80 hover:border-brand-400/40 dark:border-night-line'
              }`}
            >
              {/* a tiny swatch of each theme's material */}
              <span className="flex h-12 w-full overflow-hidden rounded-[10px] border border-line/60 dark:border-night-line">
                {o.id !== 'dark' && <span className="flex-1 bg-[radial-gradient(90%_90%_at_20%_0%,#fff,#ece5d6)]" />}
                {o.id !== 'light' && <span className="flex-1 bg-[radial-gradient(90%_90%_at_20%_0%,#2a2f3f,#0f1628)]" />}
              </span>
              <span className="flex items-center gap-2 text-sm font-medium">
                <Icon size={15} strokeWidth={1.5} className={on ? 'text-brand-600 dark:text-brand-300' : 'text-ink-2 dark:text-slate-400'} /> {o.label}
              </span>
            </button>
          );
        })}
      </div>
      <p className="mt-3 text-xs text-ink-2 dark:text-slate-400">
        {preference === 'system' ? `Following your device: ${theme} right now. It changes when your device does.` : `Always ${preference}, whatever your device says.`} Classes and the screening room stay dark, like a cinema.
      </p>
    </Section>
  );
}

/** Recovery codes, set like an issued certificate: to be saved or printed, shown once. */
function RecoveryCodes({ codes, onDone }) {
  const toast = useToast();
  const text = `${BRAND.name} recovery codes\nEach code works once.\n\n${codes.join('\n')}\n`;
  const download = () => {
    const url = URL.createObjectURL(new Blob([text], { type: 'text/plain' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = 'recovery-codes.txt';
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  return (
    <div>
      <div className="vellum-sheet rounded-[18px] p-7" data-testid="recovery-codes">
        <p className="text-center text-[10px] font-semibold tracking-[0.34em] text-brand-700 uppercase">Recovery codes</p>
        <p className="mt-2 text-center font-display text-xl">Keep these somewhere safe</p>
        <WaveBand className="my-4" opacity={0.9} />
        <ul className="grid grid-cols-2 gap-x-8 gap-y-2 font-mono text-[15px] tracking-wider">
          {codes.map((c) => (
            <li key={c} className="text-center">
              {c}
            </li>
          ))}
        </ul>
        <p className="mt-5 text-center text-xs text-ink-2">Each code signs you in once if you lose your phone. They will not be shown again.</p>
      </div>
      <div className="mt-5 flex flex-wrap justify-end gap-2">
        <Button variant="secondary" onClick={() => copyText(text).then((ok) => toast(ok ? 'Copied' : 'Copy failed'))}>
          <Copy size={15} strokeWidth={1.6} /> Copy
        </Button>
        <Button variant="secondary" onClick={download}>
          <Download size={15} strokeWidth={1.6} /> Download
        </Button>
        <Button onClick={onDone}>I have saved them</Button>
      </div>
    </div>
  );
}

function TwoStep() {
  const { user, reloadUser } = useAuth();
  const toast = useToast();
  const on = user.twoFactor?.enabled;
  const [modal, setModal] = useState(null); // setup | codes | disable | regenerate
  const [setup, setSetup] = useState(null);
  const [qr, setQr] = useState(null);
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [codes, setCodes] = useState(null);
  const [state, setState] = useState({});
  const close = () => {
    setModal(null);
    setCode('');
    setPassword('');
    setCodes(null);
    setState({});
  };
  const begin = async () => {
    setState({ loading: true });
    try {
      const s = await api('/auth/2fa/setup', { method: 'POST' });
      setSetup(s);
      // Drawn on this device: the secret never goes to a QR-code service.
      setQr(await QRCode.toDataURL(s.otpauthUrl, { margin: 1, width: 360, color: { dark: '#161c2c', light: '#f6f1e4' } }));
      setModal('setup');
      setState({});
    } catch (err) {
      setState({});
      toast(err.message, { tone: 'error' });
    }
  };
  const run = async (fn) => {
    setState({ loading: true });
    try {
      await fn();
      setState({});
    } catch (err) {
      setState({ error: err.message });
    }
  };
  const enable = (e) => {
    e.preventDefault();
    run(async () => {
      const { recoveryCodes } = await api('/auth/2fa/enable', { method: 'POST', body: { code } });
      await reloadUser();
      setCodes(recoveryCodes);
      setModal('codes');
    });
  };
  const disable = (e) => {
    e.preventDefault();
    run(async () => {
      await api('/auth/2fa/disable', { method: 'POST', body: { password, code } });
      await reloadUser();
      close();
      toast('Two-step sign-in is off');
    });
  };
  const regenerate = (e) => {
    e.preventDefault();
    run(async () => {
      const { recoveryCodes } = await api('/auth/2fa/recovery-codes', { method: 'POST', body: { password } });
      setCodes(recoveryCodes);
      setModal('codes');
    });
  };
  return (
    <Section id="two-step" eyebrow="Security" title="Two-step sign-in">
      <div className="plate flex flex-wrap items-center gap-5 p-5">
        <span className={`flex size-12 shrink-0 items-center justify-center rounded-full border ${on ? 'border-brand-400/60 text-brand-500 dark:text-brand-300' : 'border-line text-ink-2 dark:border-night-line dark:text-slate-400'}`}>
          <ShieldCheck size={22} strokeWidth={1.4} />
        </span>
        <div className="min-w-[13rem] flex-1">
          <p className="font-medium" data-testid="two-step-status">
            {on ? 'On' : 'Off'}
          </p>
          <p className="text-sm text-ink-2 dark:text-slate-400">
            {on ? 'Signing in needs your password and a code from your authenticator app.' : 'Add a code from an authenticator app, so a stolen password is not enough.'}
          </p>
        </div>
        {on ? (
          <div className="flex gap-2">
            <Button variant="secondary" size="sm" onClick={() => setModal('regenerate')}>
              New recovery codes
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setModal('disable')}>
              Turn off
            </Button>
          </div>
        ) : (
          <Button onClick={begin} loading={state.loading}>
            Turn on
          </Button>
        )}
      </div>

      <Modal open={modal === 'setup'} onClose={close} title="Set up your authenticator" wide>
        <form onSubmit={enable} className="grid gap-7 sm:grid-cols-[200px_1fr]">
          <div>
            {qr && <img src={qr} alt="QR code for your authenticator app" className="w-full rounded-2xl" />}
          </div>
          <div className="space-y-4">
            <ol className="list-decimal space-y-2 pl-5 text-sm text-ink-2 dark:text-slate-300">
              <li>Open Google Authenticator, 1Password, Authy or any authenticator app.</li>
              <li>Scan the code, or type this key:</li>
            </ol>
            <p className="rounded-xl bg-paper-2 px-3 py-2 font-mono text-[13px] tracking-wider break-all dark:bg-night-3" data-testid="totp-secret">
              {setup?.secret.replace(/(.{4})/g, '$1 ').trim()}
            </p>
            {state.error && <Alert>{state.error}</Alert>}
            <Field label="Six-digit code from the app" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} />
            <div className="flex justify-end gap-2">
              <Button type="button" variant="ghost" onClick={close}>
                Cancel
              </Button>
              <Button type="submit" loading={state.loading} disabled={code.length !== 6}>
                Turn on
              </Button>
            </div>
          </div>
        </form>
      </Modal>

      <Modal open={modal === 'codes'} onClose={() => {}} title="Two-step sign-in is on">
        {codes && <RecoveryCodes codes={codes} onDone={close} />}
      </Modal>

      <Modal open={modal === 'disable'} onClose={close} title="Turn off two-step sign-in">
        <form onSubmit={disable} className="space-y-4">
          {state.error && <Alert>{state.error}</Alert>}
          <Field label="Your password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
          <Field label="Authenticator or recovery code" autoComplete="off" value={code} onChange={(e) => setCode(e.target.value)} />
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={close}>
              Keep it on
            </Button>
            <Button type="submit" variant="danger" loading={state.loading} disabled={!password || code.trim().length < 6}>
              Turn off
            </Button>
          </div>
        </form>
      </Modal>

      <Modal open={modal === 'regenerate'} onClose={close} title="New recovery codes">
        <form onSubmit={regenerate} className="space-y-4">
          <p className="text-sm text-ink-2 dark:text-slate-300">Your old codes stop working as soon as new ones are issued.</p>
          {state.error && <Alert>{state.error}</Alert>}
          <Field label="Your password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={close}>
              Cancel
            </Button>
            <Button type="submit" loading={state.loading} disabled={!password}>
              Issue new codes
            </Button>
          </div>
        </form>
      </Modal>
    </Section>
  );
}

function Password() {
  const { user } = useAuth();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ currentPassword: '', newPassword: '' });
  const [state, setState] = useState({});
  const submit = async (e) => {
    e.preventDefault();
    setState({ loading: true });
    try {
      const res = await api('/auth/change-password', { method: 'POST', body: await sessionBody(form) });
      setSession(res.accessToken, user); // the old token stopped working with the old password
      setOpen(false);
      setForm({ currentPassword: '', newPassword: '' });
      setState({});
      toast(res.signedOut ? `Password changed. ${res.signedOut} other device${res.signedOut > 1 ? 's' : ''} signed out.` : 'Password changed.', { tone: 'success' });
    } catch (err) {
      setState({ error: err.message });
    }
  };
  return (
    <Section eyebrow="Security" title="Password">
      <div className="plate flex flex-wrap items-center gap-5 p-5">
        <span className="flex size-12 shrink-0 items-center justify-center rounded-full border border-line text-ink-2 dark:border-night-line dark:text-slate-400">
          <KeyRound size={21} strokeWidth={1.4} />
        </span>
        <p className="min-w-[13rem] flex-1 text-sm text-ink-2 dark:text-slate-400">Changing it signs you out on every other device.</p>
        <Button variant="secondary" onClick={() => setOpen(true)}>
          Change password
        </Button>
      </div>
      <Modal open={open} onClose={() => setOpen(false)} title="Change password">
        <form onSubmit={submit} className="space-y-4">
          {state.error && <Alert>{state.error}</Alert>}
          <Field label="Current password" type="password" autoComplete="current-password" value={form.currentPassword} onChange={(e) => setForm({ ...form, currentPassword: e.target.value })} />
          <Field label="New password" type="password" autoComplete="new-password" hint="At least 8 characters, with letters and numbers." value={form.newPassword} onChange={(e) => setForm({ ...form, newPassword: e.target.value })} />
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" loading={state.loading} disabled={!form.currentPassword || form.newPassword.length < 8}>
              Change password
            </Button>
          </div>
        </form>
      </Modal>
    </Section>
  );
}

/** "Chrome on Windows" from a user-agent string, without pretending to more precision than it has. */
function describeDevice(ua = '') {
  const browser = /Edg\//.test(ua) ? 'Edge' : /OPR\//.test(ua) ? 'Opera' : /Firefox\//.test(ua) ? 'Firefox' : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : 'Browser';
  const os = /Android/.test(ua) ? 'Android' : /iPhone|iPad|iPod/.test(ua) ? 'iOS' : /Windows/.test(ua) ? 'Windows' : /Mac OS X/.test(ua) ? 'macOS' : /Linux/.test(ua) ? 'Linux' : '';
  return { label: os ? `${browser} on ${os}` : ua.slice(0, 40) || 'Unknown device', mobile: /Android|iPhone|iPad|Mobile/.test(ua) };
}

function Devices() {
  const toast = useToast();
  const [sessions, setSessions] = useState(null);
  const load = useCallback(async () => {
    try {
      setSessions((await api('/auth/sessions/list', { method: 'POST', body: await sessionBody() })).sessions);
    } catch {
      setSessions([]);
    }
  }, []);
  useEffect(() => {
    load();
  }, [load]);
  const revoke = async (id) => {
    await api(`/auth/sessions/${id}`, { method: 'DELETE' }).catch((e) => toast(e.message, { tone: 'error' }));
    load();
  };
  const revokeOthers = async () => {
    const { signedOut } = await api('/auth/sessions/revoke-others', { method: 'POST', body: await sessionBody() });
    toast(signedOut ? `Signed out ${signedOut} other device${signedOut > 1 ? 's' : ''}` : 'No other devices were signed in');
    load();
  };
  const others = sessions?.filter((s) => !s.current).length ?? 0;
  return (
    <Section
      eyebrow="Security"
      title="Signed-in devices"
      aside={
        others > 0 && (
          <Button size="sm" variant="secondary" onClick={revokeOthers}>
            <LogOut size={14} strokeWidth={1.6} /> Sign out all others
          </Button>
        )
      }
    >
      {!sessions ? (
        <Spinner />
      ) : (
        <ul className="divide-y divide-line/80 border-y border-line/80 dark:divide-night-line dark:border-night-line" data-testid="devices">
          {sessions.map((s) => {
            const d = describeDevice(s.userAgent);
            const Icon = d.mobile ? Smartphone : Laptop;
            return (
              <li key={s.id} className="flex items-center gap-4 py-4">
                <Icon size={20} strokeWidth={1.4} className="shrink-0 text-ink-2 dark:text-slate-400" />
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">
                    {d.label}
                    {s.current && (
                      <span className="ml-2 inline-flex items-center gap-1 rounded-full border border-brand-400/40 px-2 py-0.5 text-[11px] font-normal text-brand-600 dark:text-brand-300">
                        <Check size={11} /> This device
                      </span>
                    )}
                  </p>
                  <p className="text-xs text-ink-2 dark:text-slate-400">
                    Signed in {new Date(s.signedInAt).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })} · last active{' '}
                    {new Date(s.lastActiveAt).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}
                    {s.ip && ` · ${s.ip}`}
                  </p>
                </div>
                {!s.current && (
                  <Button size="sm" variant="ghost" onClick={() => revoke(s.id)}>
                    Sign out
                  </Button>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </Section>
  );
}
