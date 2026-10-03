import { useLiveQuery } from 'dexie-react-hooks';
import { ArrowRight, CheckCheck, CloudOff, Hand, TriangleAlert } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { Gallery } from '../components/Gallery';
import { StatusBadge } from '../components/StatusBadge';
import { useToast } from '../components/Toast';
import { Button, Card, EmptyState, Spinner } from '../components/ui';
import { t } from '../i18n';
import { formatDateTime } from '../lib/format';
import { db } from '../offline/db';
import { recordAction } from '../offline/worker-sync';
import { requestBackgroundSync } from '../pwa/sw-bridge';
import { closeRequestNotification, useWorkerSyncState } from './WorkerContext';

export function WorkerRequestPage() {
  const { recipientId = '' } = useParams();
  const { user } = useAuth();
  const { sync, syncing } = useWorkerSyncState();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const item = useLiveQuery(async () => (await db.requests.get(recipientId)) ?? null, [recipientId]);
  const pending = useLiveQuery(() => db.queue.where('recipientId').equals(recipientId).count(), [recipientId], 0);
  const openedOnce = useRef(false);

  // Opening the request: record "opened" (stops reminders + in-app alert) and silence its notification.
  useEffect(() => {
    if (!item || !user || openedOnce.current) return;
    openedOnce.current = true;
    void closeRequestNotification(recipientId);
    if (!item.openedAt) {
      void recordAction(user.id, recipientId, 'open').then(() => sync());
    }
  }, [item, user, recipientId, sync]);

  // Opened from a notification before the first sync finished: wait for it.
  if (item === undefined || (item === null && syncing)) return <Spinner />;
  if (item === null || !user) {
    return <EmptyState title={t.requests.noResults} action={<Link to="/worker" className="text-brand-700 underline">{t.common.back}</Link>} />;
  }

  const act = async (type: 'acknowledge' | 'complete') => {
    setBusy(true);
    try {
      await recordAction(user.id, recipientId, type);
      await closeRequestNotification(recipientId);
      if (!navigator.onLine) {
        toast.info(t.worker.savedOffline);
        void requestBackgroundSync();
      } else {
        toast.success(type === 'acknowledge' ? t.worker.acknowledged : t.worker.completed);
      }
      void sync();
    } finally {
      setBusy(false);
    }
  };

  const cancelled = item.status === 'CANCELLED' || item.requestStatus === 'CANCELLED';
  const times: Array<[string, string | null]> = [
    [t.worker.sentAt, item.sentAt],
    [t.requests.opened, item.openedAt],
    [t.requests.acknowledgedAt, item.acknowledgedAt],
    [t.requests.completedAt, item.completedAt],
    [t.requests.cancelledAt, item.cancelledAt],
    [t.requests.reopenedAt, item.reopenedAt],
  ];

  return (
    <div className="space-y-4">
      <Link to={item.status === 'COMPLETED' || cancelled ? '/worker/history' : '/worker'} className="inline-flex items-center gap-1 text-brand-700">
        <ArrowRight className="size-5" aria-hidden />
        {t.common.back}
      </Link>

      {cancelled && (
        <div className="flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-100 p-3 font-semibold text-slate-700" role="status">
          <TriangleAlert className="size-5" aria-hidden />
          {t.worker.requestCancelled}
        </div>
      )}
      {item.editedAt && !cancelled && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">{t.worker.requestEdited}</div>
      )}

      <Card className="space-y-4 p-4">
        <div className="flex items-start justify-between gap-3">
          <h1 className="text-2xl font-bold leading-9">{item.title}</h1>
          <StatusBadge status={item.status} large />
        </div>
        <p className="text-muted">
          {t.worker.from} <span className="font-semibold text-ink">{item.managerName}</span> · <span className="ltr-nums">#{item.number}</span>
        </p>
        <Gallery images={item.attachments} />
      </Card>

      {!cancelled && item.status !== 'COMPLETED' && (
        <div className="space-y-3">
          {item.status === 'NEW' ? (
            <Button size="xl" className="w-full" loading={busy} icon={<Hand className="size-7" />} onClick={() => act('acknowledge')}>
              {t.worker.acknowledge}
            </Button>
          ) : (
            <Button size="xl" variant="success" className="w-full" loading={busy} icon={<CheckCheck className="size-7" />} onClick={() => act('complete')}>
              {t.worker.complete}
            </Button>
          )}
        </div>
      )}

      {pending > 0 && (
        <p className="flex items-center gap-2 text-sm font-semibold text-amber-800">
          <CloudOff className="size-4" aria-hidden />
          {t.worker.pendingSync}
        </p>
      )}

      <Card className="p-4">
        <h2 className="mb-2 font-bold">{t.requests.timeline}</h2>
        <dl className="divide-y divide-line text-sm">
          {times
            .filter(([, v]) => v)
            .map(([label, v]) => (
              <div key={label} className="flex justify-between gap-4 py-2">
                <dt className="text-muted">{label}</dt>
                <dd className="ltr-nums">{formatDateTime(v)}</dd>
              </div>
            ))}
        </dl>
      </Card>
    </div>
  );
}
