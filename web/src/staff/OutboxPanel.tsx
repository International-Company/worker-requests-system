import { CloudUpload, RefreshCw, Trash2 } from 'lucide-react';
import { useAuth } from '../auth/AuthContext';
import { Button, Card, IconButton } from '../components/ui';
import { t } from '../i18n';
import { discardOutbox, sendOne } from '../offline/outbox';
import { useOutboxEntries } from './useOutbox';

/** Requests saved while offline (or interrupted mid-upload), waiting to be sent automatically. */
export function OutboxPanel() {
  const { user } = useAuth();
  const entries = useOutboxEntries(user?.id);
  if (!entries.length) return null;
  return (
    <Card className="mb-4 border-amber-200 bg-amber-50 p-4">
      <h2 className="mb-2 flex items-center gap-2 font-bold text-amber-900">
        <CloudUpload className="size-5" aria-hidden />
        {t.requests.pendingOutbox} ({entries.length})
      </h2>
      <ul className="divide-y divide-amber-200">
        {entries.map((e) => (
          <li key={e.idempotencyKey} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
            <div>
              <p className="font-semibold text-ink">{e.title}</p>
              <p className="text-xs text-amber-900">
                {e.status === 'sending' ? t.requests.sending : e.permanent ? e.lastError : t.requests.queuedOffline}
              </p>
            </div>
            <div className="flex gap-1">
              <Button size="sm" variant="secondary" icon={<RefreshCw className="size-4" />} onClick={() => void sendOne(e.idempotencyKey)}>
                {t.requests.retrySend}
              </Button>
              <IconButton label={t.requests.discard} onClick={() => void discardOutbox(e.idempotencyKey)}>
                <Trash2 className="size-4" />
              </IconButton>
            </div>
          </li>
        ))}
      </ul>
    </Card>
  );
}
