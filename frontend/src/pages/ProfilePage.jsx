import { useState } from 'react';
import { useAuth } from '../contexts/AuthContext.jsx';
import { useToast } from '../contexts/ToastContext.jsx';
import { api } from '../services/api.js';
import { Alert, Avatar, Button, Field } from '../components/ui/index.jsx';

export default function ProfilePage() {
  const { user, setUser } = useAuth();
  const toast = useToast();
  const isTeacher = user.role === 'teacher';
  const profile = (isTeacher ? user.teacherProfile : user.studentProfile) || {};
  const [form, setForm] = useState({
    name: user.name,
    bio: profile.bio || '',
    subjects: (profile.subjects || []).join(', '),
    gradeLevel: profile.gradeLevel || '',
  });
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
      toast('Profile saved', { tone: 'success' });
    } catch (err) {
      setState({ error: err.message });
    }
  };

  return (
    <div className="mx-auto max-w-xl">
      <div className="mb-8 flex items-center gap-4">
        <Avatar name={user.name} size={64} />
        <div>
          <h1 className="font-display text-3xl font-semibold">{user.name}</h1>
          <p className="text-ink-2 capitalize dark:text-stone-400">
            {user.role} · {user.email} {user.emailVerified ? '' : '(unverified)'}
          </p>
        </div>
      </div>
      <form onSubmit={save} className="card space-y-4 p-6">
        {state.error && <Alert>{state.error}</Alert>}
        <Field label="Display name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} maxLength={80} required />
        {user.role !== 'admin' && (
          <div>
            <label className="label" htmlFor="bio">
              About
            </label>
            <textarea id="bio" className="input min-h-24" maxLength={1000} value={form.bio} onChange={(e) => setForm({ ...form, bio: e.target.value })} />
          </div>
        )}
        {isTeacher && <Field label="Subjects" hint="Comma separated" value={form.subjects} onChange={(e) => setForm({ ...form, subjects: e.target.value })} />}
        {user.role === 'student' && <Field label="Grade / level" value={form.gradeLevel} onChange={(e) => setForm({ ...form, gradeLevel: e.target.value })} maxLength={50} />}
        <div className="flex justify-end">
          <Button type="submit" loading={state.loading}>
            Save changes
          </Button>
        </div>
      </form>
    </div>
  );
}
