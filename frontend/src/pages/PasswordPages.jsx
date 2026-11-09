import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { AuthLayout } from '../components/AppShell.jsx';
import { Alert, Button, Field } from '../components/ui/index.jsx';
import { api } from '../services/api.js';

export function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [state, setState] = useState({});
  const submit = async (e) => {
    e.preventDefault();
    setState({ loading: true });
    try {
      const res = await api('/auth/forgot-password', { method: 'POST', body: { email } });
      setState({ done: res.message });
    } catch (err) {
      setState({ error: err.message });
    }
  };
  return (
    <AuthLayout title="Reset your password" subtitle="We'll email you a link to choose a new one." footer={<Link className="font-semibold text-brand-600 hover:underline dark:text-brand-400" to="/login">Back to sign in</Link>}>
      {state.done ? (
        <Alert tone="success">{state.done}</Alert>
      ) : (
        <form onSubmit={submit} className="space-y-4">
          {state.error && <Alert>{state.error}</Alert>}
          <Field label="Email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
          <Button type="submit" size="lg" className="w-full" loading={state.loading}>
            Send reset link
          </Button>
        </form>
      )}
    </AuthLayout>
  );
}

export function ResetPasswordPage() {
  const [params] = useSearchParams();
  const [pw, setPw] = useState({ a: '', b: '' });
  const [state, setState] = useState({});
  const submit = async (e) => {
    e.preventDefault();
    if (pw.a !== pw.b) return setState({ error: 'Passwords don’t match' });
    setState({ loading: true });
    try {
      await api('/auth/reset-password', { method: 'POST', body: { token: params.get('token') || '', password: pw.a } });
      setState({ done: true });
    } catch (err) {
      setState({ error: err.message });
    }
    return undefined;
  };
  return (
    <AuthLayout title="Choose a new password">
      {state.done ? (
        <div className="space-y-4">
          <Alert tone="success">Password updated. You've been signed out of other devices.</Alert>
          <Link to="/login">
            <Button className="w-full">Sign in</Button>
          </Link>
        </div>
      ) : (
        <form onSubmit={submit} className="space-y-4">
          {state.error && <Alert>{state.error}</Alert>}
          <Field label="New password" type="password" autoComplete="new-password" value={pw.a} onChange={(e) => setPw({ ...pw, a: e.target.value })} hint="8+ characters, letters and numbers" />
          <Field label="Confirm password" type="password" autoComplete="new-password" value={pw.b} onChange={(e) => setPw({ ...pw, b: e.target.value })} />
          <Button type="submit" size="lg" className="w-full" loading={state.loading}>
            Update password
          </Button>
        </form>
      )}
    </AuthLayout>
  );
}
