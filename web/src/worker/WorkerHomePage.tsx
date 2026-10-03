import { useLiveQuery } from 'dexie-react-hooks';
import { ClipboardCheck, ClipboardList } from 'lucide-react';
import { useAuth } from '../auth/AuthContext';
import { EmptyState, Spinner } from '../components/ui';
import { t } from '../i18n';
import { formatTime } from '../lib/format';
import type { WorkerRequest } from '../lib/types';
import { db } from '../offline/db';
import { InstallPrompt } from '../pwa/InstallPrompt';
import { PushCard } from './PushCard';
import { RequestCard } from './RequestCard';
import { useWorkerSyncState } from './WorkerContext';

const byNewest = (a: WorkerRequest, b: WorkerRequest) => b.sentAt.localeCompare(a.sentAt);

export function WorkerHomePage({ mode }: { mode: 'current' | 'previous' }) {
  const { user } = useAuth();
  const { lastSyncAt, syncing } = useWorkerSyncState();
  const data = useLiveQuery(async () => {
    if (!user) return { items: [] as WorkerRequest[], pending: new Set<string>() };
    const all = await db.requests.where('userId').equals(user.id).toArray();
    const queue = await db.queue.where('userId').equals(user.id).toArray();
    const current = (r: WorkerRequest) => r.requestStatus === 'ACTIVE' && (r.status === 'NEW' || r.status === 'ACKNOWLEDGED');
    return {
      items: all.filter((r) => (mode === 'current' ? current(r) : !current(r))).sort(byNewest),
      pending: new Set(queue.map((q) => q.recipientId)),
    };
  }, [user?.id, mode]);

  return (
    <div className="space-y-4">
      {mode === 'current' && (
        <>
          <InstallPrompt />
          <PushCard compact />
        </>
      )}
      <div className="flex items-baseline justify-between">
        <h1 className="text-xl font-bold">{mode === 'current' ? t.nav.current : t.nav.previous}</h1>
        <span className="text-xs text-muted">
          {syncing ? t.worker.syncing : lastSyncAt ? `${t.worker.lastSync} ${formatTime(lastSyncAt)}` : null}
        </span>
      </div>
      {!data ? (
        <Spinner />
      ) : data.items.length === 0 ? (
        <EmptyState
          icon={mode === 'current' ? <ClipboardList className="size-12" /> : <ClipboardCheck className="size-12" />}
          title={mode === 'current' ? t.worker.currentEmpty : t.worker.previousEmpty}
        />
      ) : (
        <div className="space-y-4">
          {data.items.map((item) => (
            <RequestCard key={item.recipientId} item={item} pending={data.pending.has(item.recipientId)} />
          ))}
        </div>
      )}
    </div>
  );
}
