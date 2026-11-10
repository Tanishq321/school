import { lazy, Suspense } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { useAuth } from './contexts/AuthContext.jsx';
import AppShell from './components/AppShell.jsx';
import { FullPageSpinner } from './components/ui/index.jsx';
import LoginPage from './pages/LoginPage.jsx';
import RegisterPage from './pages/RegisterPage.jsx';
import VerifyEmailPage from './pages/VerifyEmailPage.jsx';
import { ForgotPasswordPage, ResetPasswordPage } from './pages/PasswordPages.jsx';
import TodayPage from './pages/TodayPage.jsx';
import CalendarPage from './pages/CalendarPage.jsx';
import ClassesPage from './pages/ClassesPage.jsx';
import ClassDetailPage from './pages/ClassDetailPage.jsx';
import RecordingsPage from './pages/RecordingsPage.jsx';
import RecordingPage from './pages/RecordingPage.jsx';
// Heavy media code (mediasoup-client, WebRTC helpers) loads only when entering a room.
const MeetingPage = lazy(() => import('./pages/MeetingPage.jsx'));
const DiagnosticsPage = lazy(() => import('./pages/DiagnosticsPage.jsx'));
import ProfilePage from './pages/ProfilePage.jsx';
import NotFoundPage from './pages/NotFoundPage.jsx';
const admin = () => import('./pages/AdminPages.jsx');
const AdminOverview = lazy(() => admin().then((m) => ({ default: m.AdminOverview })));
const AdminPeople = lazy(() => admin().then((m) => ({ default: m.AdminPeople })));
const AdminClasses = lazy(() => admin().then((m) => ({ default: m.AdminClasses })));
const AdminAudit = lazy(() => admin().then((m) => ({ default: m.AdminAudit })));
import LandingPage from './pages/LandingPage.jsx';

/** Only allow same-site relative paths as post-login destinations (no open redirects). */
export const safeNext = (next) => (next && next.startsWith('/') && !next.startsWith('//') && !next.startsWith('/\\') ? next : '/');

function RequireAuth({ children }) {
  const { status } = useAuth();
  const location = useLocation();
  if (status === 'loading') return <FullPageSpinner />;
  if (status === 'anon') return <Navigate to={`/login?next=${encodeURIComponent(location.pathname + location.search)}`} replace />;
  return children;
}

/** Visitors see the landing page at "/", members see their dashboard; other member pages need sign-in. */
function MemberArea() {
  const { status } = useAuth();
  const location = useLocation();
  if (status === 'loading') return <FullPageSpinner />;
  if (status === 'anon') {
    if (location.pathname === '/') return <LandingPage />;
    return <Navigate to={`/login?next=${encodeURIComponent(location.pathname + location.search)}`} replace />;
  }
  return <AppShell />;
}

/** Administration is for administrators; everyone else is sent home (the server refuses them anyway). */
function AdminOnly({ children }) {
  const { user } = useAuth();
  if (user?.role !== 'admin') return <Navigate to="/" replace />;
  return <Suspense fallback={<FullPageSpinner />}>{children}</Suspense>;
}

function GuestOnly({ children }) {
  const { status } = useAuth();
  const location = useLocation();
  if (status === 'loading') return <FullPageSpinner />;
  if (status === 'authed') return <Navigate to={safeNext(new URLSearchParams(location.search).get('next'))} replace />;
  return children;
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<GuestOnly><LoginPage /></GuestOnly>} />
      <Route path="/register" element={<GuestOnly><RegisterPage /></GuestOnly>} />
      <Route path="/forgot-password" element={<ForgotPasswordPage />} />
      <Route path="/reset-password" element={<ResetPasswordPage />} />
      <Route path="/verify-email" element={<VerifyEmailPage />} />
      <Route path="/m/:code" element={<RequireAuth><Suspense fallback={<FullPageSpinner label="Preparing the room…" />}><MeetingPage /></Suspense></RequireAuth>} />
      <Route element={<MemberArea />}>
        <Route index element={<TodayPage />} />
        <Route path="/calendar" element={<CalendarPage />} />
        <Route path="/classes" element={<ClassesPage />} />
        <Route path="/classes/:code" element={<ClassDetailPage />} />
        <Route path="/recordings" element={<RecordingsPage />} />
        <Route path="/recordings/:id" element={<RecordingPage />} />
        <Route path="/diagnostics" element={<Suspense fallback={<FullPageSpinner />}><DiagnosticsPage /></Suspense>} />
        <Route path="/profile" element={<ProfilePage />} />
        <Route path="/admin" element={<AdminOnly><AdminOverview /></AdminOnly>} />
        <Route path="/admin/people" element={<AdminOnly><AdminPeople /></AdminOnly>} />
        <Route path="/admin/classes" element={<AdminOnly><AdminClasses /></AdminOnly>} />
        <Route path="/admin/audit" element={<AdminOnly><AdminAudit /></AdminOnly>} />
      </Route>
      <Route path="*" element={<NotFoundPage />} />
    </Routes>
  );
}
