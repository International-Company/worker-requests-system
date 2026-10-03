import { lazy, Suspense } from 'react';
import { useAuth } from './auth/AuthContext';
import { Spinner } from './components/ui';
import { LoginPage } from './pages/LoginPage';

// Code-split per role: a worker's phone never downloads the dashboard screens.
// (All chunks are still precached by the service worker for offline use.)
const WorkerApp = lazy(() => import('./worker/WorkerRoutes'));
const StaffApp = lazy(() => import('./staff/StaffRoutes'));

/** One PWA, three role-specific experiences. Routes outside a role are never rendered. */
export function App() {
  const { user, ready } = useAuth();
  if (!ready) return <Spinner />;
  if (!user) return <LoginPage />;

  return (
    <Suspense fallback={<Spinner />}>{user.role === 'WORKER' ? <WorkerApp /> : <StaffApp isAdmin={user.role === 'SYSTEM_ADMIN'} />}</Suspense>
  );
}
