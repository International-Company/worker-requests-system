import { CheckCheck, CircleDot, Hand, Send, Wifi, XCircle } from 'lucide-react';
import type { ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { PresenceLabel } from '../components/Presence';
import { Button, Card, cx, EmptyState, ErrorBox, PageHeader, Spinner } from '../components/ui';
import { fmt, t } from '../i18n';
import { errorMessage } from '../lib/api';
import { RecipientChips } from './RecipientChips';
import { useDashboard, useRequests, useWorkers } from './queries';
import { formatTime } from '../lib/format';

export function DashboardPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const stats = useDashboard();
  const recent = useRequests({ page: 1, pageSize: 8 });
  const workers = useWorkers();
  const isManager = user?.role === 'MANAGER';

  return (
    <div>
      <PageHeader
        title={t.nav.dashboard}
        actions={
          isManager && (
            <Button size="lg" icon={<Send className="size-5" />} onClick={() => navigate('/app/requests/new')}>
              {t.dashboard.sendNew}
            </Button>
          )
        }
      />

      {stats.isError ? (
        <ErrorBox message={errorMessage(stats.error)} onRetry={() => void stats.refetch()} />
      ) : (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
          <Stat
            icon={<Wifi />}
            tone="emerald"
            label={t.dashboard.onlineWorkers}
            value={stats.data?.onlineWorkers}
            hint={stats.data ? fmt(t.dashboard.ofActive, { n: stats.data.activeWorkers }) : undefined}
            to="/app/workers"
          />
          <Stat icon={<CircleDot />} tone="brand" label={t.dashboard.newRequests} value={stats.data?.newRequests} to={`${listPath(isManager)}?status=NEW`} />
          <Stat icon={<Hand />} tone="amber" label={t.dashboard.inProgress} value={stats.data?.inProgress} to={`${listPath(isManager)}?status=ACKNOWLEDGED`} />
          <Stat icon={<CheckCheck />} tone="emerald" label={t.dashboard.completed} value={stats.data?.completedToday} to={`${historyPath(isManager)}?status=COMPLETED`} />
          <Stat icon={<XCircle />} tone="slate" label={t.dashboard.cancelled} value={stats.data?.cancelledToday} to={`${historyPath(isManager)}?status=CANCELLED`} />
        </div>
      )}

      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <div className="flex items-center justify-between border-b border-line px-4 py-3">
            <h2 className="font-bold">{t.dashboard.recent}</h2>
            <Link to={historyPath(isManager)} className="text-sm text-brand-700 hover:underline">
              {t.dashboard.viewAll}
            </Link>
          </div>
          {recent.isLoading ? (
            <Spinner />
          ) : !recent.data?.items.length ? (
            <EmptyState title={t.dashboard.noRequests} />
          ) : (
            <ul className="divide-y divide-line">
              {recent.data.items.map((r) => (
                <li key={r.id}>
                  <Link to={`/app/requests/${r.id}`} className="block space-y-2 px-4 py-3 hover:bg-surface">
                    <div className="flex items-center justify-between gap-3">
                      <span className="font-semibold">
                        <span className="ltr-nums text-muted">#{r.number}</span> {r.title}
                      </span>
                      <span className="ltr-nums shrink-0 text-xs text-muted">{formatTime(r.createdAt)}</span>
                    </div>
                    <RecipientChips request={r} max={6} />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card>
          <div className="border-b border-line px-4 py-3">
            <h2 className="font-bold">{t.nav.workers}</h2>
          </div>
          {workers.isLoading ? (
            <Spinner />
          ) : (
            <ul className="max-h-[28rem] divide-y divide-line overflow-y-auto">
              {(workers.data ?? [])
                .filter((w) => w.isActive)
                .sort((a, b) => Number(b.isOnline) - Number(a.isOnline))
                .map((w) => (
                  <li key={w.id} className="flex items-center justify-between gap-3 px-4 py-2.5">
                    <span className="truncate font-medium">{w.name}</span>
                    <PresenceLabel online={w.isOnline} lastSeenAt={w.lastSeenAt} hasDevice={Boolean(w.device)} />
                  </li>
                ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}

/** Managers: open requests live under /app/requests, full history under /app/history. Admin: one list. */
const listPath = (_isManager: boolean) => '/app/requests';
const historyPath = (isManager: boolean) => (isManager ? '/app/history' : '/app/requests');

const tones = {
  brand: 'bg-brand-50 text-brand-700',
  amber: 'bg-amber-50 text-amber-700',
  emerald: 'bg-emerald-50 text-emerald-700',
  slate: 'bg-slate-100 text-slate-600',
};

function Stat({ icon, label, value, hint, tone, to }: { icon: ReactNode; label: string; value?: number; hint?: string; tone: keyof typeof tones; to: string }) {
  return (
    <Link to={to} className="block">
      <Card className="h-full p-4 transition-shadow hover:shadow-md">
        <div className={cx('mb-3 flex size-10 items-center justify-center rounded-lg [&>svg]:size-5', tones[tone])}>{icon}</div>
        <p className="ltr-nums text-3xl font-bold">{value ?? '–'}</p>
        <p className="mt-1 text-sm text-muted">{label}</p>
        {hint && <p className="text-xs text-muted">{hint}</p>}
      </Card>
    </Link>
  );
}
