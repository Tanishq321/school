import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { GraduationCap, Presentation } from 'lucide-react';
import { AuthLayout } from '../components/AppShell.jsx';
import { Alert, Button, Field } from '../components/ui/index.jsx';
import { useAuth } from '../contexts/AuthContext.jsx';
import { safeNext } from '../App.jsx';

const ROLES = [
  { value: 'student', label: 'I’m a student', icon: GraduationCap, hint: 'Join classes' },
  { value: 'teacher', label: 'I’m a teacher', icon: Presentation, hint: 'Host classes' },
];

export default function RegisterPage() {
  const { register } = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [form, setForm] = useState({ name: '', email: '', password: '', role: 'student' });
  const [errors, setErrors] = useState({});
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  const validate = () => {
    const e = {};
    if (!form.name.trim()) e.name = 'Enter your name';
    if (!/^\S+@\S+\.\S+$/.test(form.email)) e.email = 'Enter a valid email address';
    if (form.password.length < 8) e.password = 'At least 8 characters';
    else if (!/[A-Za-z]/.test(form.password) || !/\d/.test(form.password)) e.password = 'Use letters and numbers';
    setErrors(e);
    return !Object.keys(e).length;
  };

  const submit = async (e) => {
    e.preventDefault();
    setError(null);
    if (!validate()) return;
    setLoading(true);
    try {
      await register({ ...form, name: form.name.trim() });
      navigate(safeNext(params.get('next')), { replace: true });
    } catch (err) {
      setError(err.message);
      setLoading(false);
    }
  };

  return (
    <AuthLayout
      title="Create your account"
      subtitle="It takes less than a minute."
      footer={
        <>
          Already have an account?{' '}
          <Link className="font-semibold text-brand-600 hover:underline dark:text-brand-400" to={`/login${params.get('next') ? `?next=${encodeURIComponent(params.get('next'))}` : ''}`}>
            Sign in
          </Link>
        </>
      }
    >
      <form onSubmit={submit} className="space-y-4" noValidate>
        {error && <Alert>{error}</Alert>}
        <fieldset>
          <legend className="label">Account type</legend>
          <div className="grid grid-cols-2 gap-2">
            {ROLES.map(({ value, label, icon: Icon, hint }) => (
              <label
                key={value}
                className={`flex cursor-pointer flex-col gap-1 rounded-xl border p-3 transition ${
                  form.role === value ? 'border-brand-500 bg-brand-50 ring-2 ring-brand-500/20 dark:bg-brand-700/15' : 'border-line hover:border-stone-400 dark:border-night-line'
                }`}
              >
                <input type="radio" name="role" value={value} checked={form.role === value} onChange={set('role')} className="sr-only" />
                <Icon size={20} className="text-brand-600 dark:text-brand-400" />
                <span className="text-sm font-semibold">{label}</span>
                <span className="text-xs text-ink-2 dark:text-slate-400">{hint}</span>
              </label>
            ))}
          </div>
        </fieldset>
        <Field label="Full name" autoComplete="name" value={form.name} onChange={set('name')} error={errors.name} />
        <Field label="Email" type="email" autoComplete="email" value={form.email} onChange={set('email')} error={errors.email} />
        <Field label="Password" type="password" autoComplete="new-password" value={form.password} onChange={set('password')} error={errors.password} hint="8+ characters, letters and numbers" />
        <Button type="submit" size="lg" className="w-full" loading={loading}>
          Create account
        </Button>
      </form>
    </AuthLayout>
  );
}
