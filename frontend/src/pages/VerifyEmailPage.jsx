import { useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { AuthLayout } from '../components/AppShell.jsx';
import { Alert, Button, Spinner } from '../components/ui/index.jsx';
import { api } from '../services/api.js';
import { useAuth } from '../contexts/AuthContext.jsx';

export default function VerifyEmailPage() {
  const [params] = useSearchParams();
  const { status: authStatus, setUser } = useAuth();
  const [state, setState] = useState({ status: 'working' });
  const ran = useRef(false);

  useEffect(() => {
    if (ran.current) return; // tokens are single-use; avoid StrictMode double submit
    ran.current = true;
    const token = params.get('token');
    if (!token) {
      setState({ status: 'error', message: 'This link is missing its token.' });
      return;
    }
    api('/auth/verify-email', { method: 'POST', body: { token } })
      .then(({ user }) => {
        setState({ status: 'ok' });
        if (authStatus === 'authed') setUser(user);
      })
      .catch((err) => setState({ status: 'error', message: err.message }));
  }, [params, authStatus, setUser]);

  return (
    <AuthLayout title="Email verification">
      {state.status === 'working' && (
        <div className="flex items-center gap-3 text-ink-2">
          <Spinner /> Verifying…
        </div>
      )}
      {state.status === 'ok' && (
        <div className="space-y-4">
          <Alert tone="success">Your email is verified. You can now host and join classes.</Alert>
          <Link to="/">
            <Button className="w-full">Go to dashboard</Button>
          </Link>
        </div>
      )}
      {state.status === 'error' && (
        <div className="space-y-4">
          <Alert>{state.message} You can request a new link from your dashboard.</Alert>
          <Link to="/">
            <Button variant="secondary" className="w-full">
              Back to dashboard
            </Button>
          </Link>
        </div>
      )}
    </AuthLayout>
  );
}
