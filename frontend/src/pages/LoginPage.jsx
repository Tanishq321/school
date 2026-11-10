import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { AuthLayout } from '../components/AppShell.jsx';
import { Alert, Button, Field } from '../components/ui/index.jsx';
import { useAuth } from '../contexts/AuthContext.jsx';
import { safeNext } from '../App.jsx';

export default function LoginPage() {
  const { login, loginSecondStep } = useAuth();
  const [step, setStep] = useState(null); // { challenge } once the password is accepted
  const [code, setCode] = useState('');
  const [useRecovery, setUseRecovery] = useState(false);
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const [form, setForm] = useState({ email: '', password: '' });
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);
  const next = params.get('next');

  const submit = async (e) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await login(form.email, form.password);
      if (res.twoFactorRequired) {
        setStep({ challenge: res.challenge });
        setLoading(false);
        return;
      }
      navigate(safeNext(next), { replace: true, viewTransition: true });
    } catch (err) {
      setError(err.message);
      setLoading(false);
    }
  };

  const submitCode = async (e) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await loginSecondStep(step.challenge, code);
      navigate(safeNext(next), { replace: true, viewTransition: true });
    } catch (err) {
      setError(err.message);
      setLoading(false);
      if (err.code === 'challenge_expired') setStep(null);
    }
  };

  if (step) {
    return (
      <AuthLayout title="One more step" subtitle={useRecovery ? 'Enter one of your recovery codes.' : 'Enter the six-digit code from your authenticator app.'}>
        <form onSubmit={submitCode} className="space-y-5" noValidate>
          {error && <Alert>{error}</Alert>}
          {useRecovery ? (
            <Field label="Recovery code" autoFocus autoComplete="off" spellCheck={false} placeholder="xxxx-xxxx-xxxx" value={code} onChange={(e) => setCode(e.target.value)} />
          ) : (
            <div>
              <label className="label" htmlFor="otp">
                Authentication code
              </label>
              <input
                id="otp"
                autoFocus
                inputMode="numeric"
                autoComplete="one-time-code"
                pattern="[0-9]*"
                maxLength={6}
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                className="input h-16 text-center font-display text-[2.1rem] tracking-[0.42em] tabular-nums"
                placeholder="······"
                aria-label="Six-digit code"
              />
            </div>
          )}
          <Button type="submit" size="lg" className="w-full" loading={loading} disabled={useRecovery ? code.trim().length < 12 : code.length !== 6}>
            Verify and sign in
          </Button>
          <div className="flex justify-between text-sm">
            <button type="button" className="text-ink-2 hover:underline dark:text-slate-400" onClick={() => { setStep(null); setCode(''); setError(null); }}>
              Back
            </button>
            <button type="button" className="font-medium text-brand-600 hover:underline dark:text-brand-400" onClick={() => { setUseRecovery((v) => !v); setCode(''); setError(null); }}>
              {useRecovery ? 'Use the authenticator app' : 'Use a recovery code'}
            </button>
          </div>
        </form>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout
      title="Welcome back"
      subtitle={next?.startsWith('/m/') ? 'Sign in to join the class.' : 'Sign in to your classes.'}
      footer={
        <>
          New here?{' '}
          <Link className="font-semibold text-brand-600 hover:underline dark:text-brand-400" to={`/register${next ? `?next=${encodeURIComponent(next)}` : ''}`}>
            Create an account
          </Link>
        </>
      }
    >
      <form onSubmit={submit} className="space-y-4" noValidate>
        {error && <Alert>{error}</Alert>}
        <Field label="Email" type="email" autoComplete="email" required value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
        <Field label="Password" type="password" autoComplete="current-password" required value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
        <div className="flex justify-end">
          <Link to="/forgot-password" className="text-sm font-medium text-brand-600 hover:underline dark:text-brand-400">
            Forgot password?
          </Link>
        </div>
        <Button type="submit" size="lg" className="w-full" loading={loading}>
          Sign in
        </Button>
      </form>
    </AuthLayout>
  );
}
