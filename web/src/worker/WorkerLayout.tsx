import { useLiveQuery } from 'dexie-react-hooks';
import { BellRing, ClipboardList, History, UserRound } from 'lucide-react';
import { useEffect } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { AppBanners } from '../components/AppBanners';
import { useToast } from '../components/Toast';
import { Button, cx } from '../components/ui';
import { useRepeatingAlert, useUnlockAudioOnFirstInteraction } from '../hooks/useAlert';
import { useWorkerSync } from '../hooks/useWorkerSync';
import { fmt, t } from '../i18n';
import { db } from '../offline/db';
import { WorkerSyncContext } from './WorkerContext';

/** Simple worker shell: top bar, content, large bottom navigation (no sidebar). */
export function WorkerLayout() {
  const { user } = useAuth();
  const state = useWorkerSync();
  const toast = useToast();
  const navigate = useNavigate();
  const location = useLocation();
  useUnlockAudioOnFirstInteraction();

  // New = not yet opened by the worker. These keep alerting (sound + vibration) while the app is open.
  const unopened = useLiveQuery(
    () =>
      user
        ? db.requests
            .where('userId')
            .equals(user.id)
            .filter((r) => r.status === 'NEW' && !r.openedAt && r.requestStatus === 'ACTIVE')
            .toArray()
        : [],
    [user?.id],
    [],
  );
  useRepeatingAlert(unopened.length > 0);

  // Offline-sync conflicts → tell the worker once.
  const notices = useLiveQuery(() => (user ? db.notices.where('userId').equals(user.id).toArray() : []), [user?.id], []);
  useEffect(() => {
    for (const n of notices) {
      const msg = n.kind === 'conflict-cancelled' ? t.worker.conflictCancelled : n.kind === 'conflict-stale' ? t.worker.conflictStale : t.common.genericError;
      toast.error(`${msg}: ${n.title}`);
      void db.notices.delete(n.id!);
    }
  }, [notices, toast]);

  const onRequestPage = location.pathname.startsWith('/worker/requests/');
  const newest = [...unopened].sort((a, b) => b.sentAt.localeCompare(a.sentAt))[0];
  const showNewBanner = newest && !(onRequestPage && location.pathname.endsWith(newest.recipientId)) && location.pathname !== '/worker';

  return (
    <WorkerSyncContext.Provider value={state}>
      <div className="flex min-h-full flex-col bg-surface">
        <header className="safe-top sticky top-0 z-30 border-b border-line bg-white">
          <AppBanners />
          <div className="mx-auto flex h-14 max-w-2xl items-center justify-between px-4">
            <span className="text-lg font-bold text-brand-700">{t.appName}</span>
            {state.pending > 0 && (
              <span className="rounded-full bg-amber-100 px-2.5 py-1 text-xs font-semibold text-amber-900">
                {t.worker.pendingSync} ({state.pending})
              </span>
            )}
          </div>
          {showNewBanner && (
            <div className="flex items-center justify-between gap-3 bg-brand-600 px-4 py-3 text-white" role="alert">
              <span className="flex items-center gap-2 font-semibold">
                <BellRing className="size-5 shrink-0" aria-hidden />
                {unopened.length > 1 ? fmt(t.worker.newBannerMany, { n: unopened.length }) : `${t.worker.newWhileReading}: ${newest.title}`}
              </span>
              <Button size="sm" variant="secondary" onClick={() => navigate(`/worker/requests/${newest.recipientId}`)}>
                {t.worker.openRequest}
              </Button>
            </div>
          )}
        </header>

        <main className="mx-auto w-full max-w-2xl flex-1 px-4 pb-28 pt-4">
          <Outlet />
        </main>

        <nav className="safe-bottom fixed inset-x-0 bottom-0 z-30 border-t border-line bg-white" aria-label={t.common.menu}>
          <div className="mx-auto grid max-w-2xl grid-cols-3">
            <Tab to="/worker" end icon={<ClipboardList className="size-6" />} label={t.nav.current} badge={unopened.length} />
            <Tab to="/worker/history" icon={<History className="size-6" />} label={t.nav.previous} />
            <Tab to="/worker/account" icon={<UserRound className="size-6" />} label={t.nav.account} />
          </div>
        </nav>
      </div>
    </WorkerSyncContext.Provider>
  );
}

function Tab({ to, icon, label, end, badge }: { to: string; icon: React.ReactNode; label: string; end?: boolean; badge?: number }) {
  return (
    <NavLink
      to={to}
      end={end}
      className={({ isActive }) =>
        cx('relative flex h-16 flex-col items-center justify-center gap-1 text-xs font-semibold', isActive ? 'text-brand-700' : 'text-muted')
      }
    >
      {icon}
      {label}
      {badge ? (
        <span className="absolute right-[calc(50%-1.6rem)] top-2 min-w-5 rounded-full bg-red-600 px-1.5 text-center text-[11px] leading-5 text-white">
          {badge}
        </span>
      ) : null}
    </NavLink>
  );
}
