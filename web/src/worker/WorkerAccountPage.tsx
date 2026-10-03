import { Info, LogOut, Volume2 } from 'lucide-react';
import { useState } from 'react';
import { useAuth } from '../auth/AuthContext';
import { PresenceLabel } from '../components/Presence';
import { Button, Card, ConfirmDialog } from '../components/ui';
import { playAlertOnce } from '../hooks/useAlert';
import { useOnline } from '../hooks/useOnline';
import { t } from '../i18n';
import { workerPhotoUrl } from '../lib/api';
import { getDeviceLabel } from '../lib/device';
import { formatDateTime } from '../lib/format';
import { InstallPrompt } from '../pwa/InstallPrompt';
import { PushCard } from './PushCard';
import { useWorkerSyncState } from './WorkerContext';

export function WorkerAccountPage() {
  const { me, user, logout } = useAuth();
  const { pending, lastSyncAt } = useWorkerSyncState();
  const online = useOnline();
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-bold">{t.worker.account}</h1>
      <Card className="flex items-center gap-4 p-4">
        {me?.photoVersion ? (
          <img src={workerPhotoUrl(me.id, me.photoVersion)} alt="" className="size-16 rounded-full object-cover" />
        ) : (
          <div className="flex size-16 items-center justify-center rounded-full bg-brand-100 text-2xl font-bold text-brand-700">{user?.name.slice(0, 1)}</div>
        )}
        <div className="space-y-1">
          <p className="text-lg font-bold">{user?.name}</p>
          {me?.phone && (
            <p className="ltr-nums text-sm text-muted" dir="ltr">
              {me.phone}
            </p>
          )}
        </div>
      </Card>

      <Card className="divide-y divide-line text-sm">
        <Row label={t.worker.connection}>
          <PresenceLabel online={online} lastSeenAt={lastSyncAt ?? null} />
        </Row>
        <Row label={t.worker.lastSync}>
          <span className="ltr-nums">{formatDateTime(lastSyncAt)}</span>
        </Row>
        <Row label={t.worker.pendingSync}>
          <span className="ltr-nums">{pending}</span>
        </Row>
        <Row label={t.worker.device}>{me?.device?.label ?? getDeviceLabel()}</Row>
      </Card>

      <h2 className="pt-2 text-lg font-bold">{t.worker.notificationsTitle}</h2>
      <InstallPrompt />
      <PushCard />
      <Button variant="secondary" size="lg" className="w-full" icon={<Volume2 className="size-5" />} onClick={() => void playAlertOnce()}>
        {t.worker.testSound}
      </Button>
      <Card className="flex gap-3 p-4 text-sm leading-7 text-muted">
        <Info className="mt-1 size-5 shrink-0 text-brand-600" aria-hidden />
        <div>
          <p className="font-semibold text-ink">{t.worker.limitsTitle}</p>
          <p>{t.worker.limits}</p>
        </div>
      </Card>

      <Button variant="danger" size="lg" className="w-full" icon={<LogOut className="size-5" />} onClick={() => setConfirm(true)}>
        {t.common.logout}
      </Button>
      <ConfirmDialog
        open={confirm}
        title={t.common.logout}
        message={t.auth.logoutConfirm}
        confirmLabel={t.common.logout}
        danger
        loading={busy}
        onClose={() => setConfirm(false)}
        onConfirm={async () => {
          setBusy(true);
          await logout();
        }}
      />
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 px-4 py-3">
      <span className="text-muted">{label}</span>
      <span className="text-ink">{children}</span>
    </div>
  );
}
