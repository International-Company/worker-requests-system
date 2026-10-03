import { BellOff, BellRing, CheckCircle2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useToast } from '../components/Toast';
import { Button, Card } from '../components/ui';
import { t } from '../i18n';
import { errorMessage } from '../lib/api';
import { enablePush, getPushState, type PushState } from '../pwa/push';

const messages: Partial<Record<PushState, string>> = {
  unsupported: t.worker.pushUnsupported,
  'ios-needs-install': t.worker.pushIosInstall,
  'server-disabled': t.worker.pushServerDisabled,
  denied: t.worker.pushDenied,
};

/** Shows notification status; the "enable" button performs the permission prompt (user gesture required). */
export function PushCard({ compact }: { compact?: boolean }) {
  const toast = useToast();
  const [state, setState] = useState<PushState | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    getPushState()
      .then(setState)
      .catch(() => setState(null));
  }, []);

  if (!state || (compact && state === 'subscribed')) return null;

  if (state === 'subscribed') {
    return (
      <Card className="flex items-center gap-3 p-4 text-emerald-800">
        <CheckCircle2 className="size-6 shrink-0" aria-hidden />
        <span className="font-semibold">{t.worker.pushEnabled}</span>
      </Card>
    );
  }

  if (state === 'prompt') {
    return (
      <Card className="space-y-3 border-brand-200 bg-brand-50 p-4">
        <div className="flex items-start gap-3">
          <BellRing className="mt-0.5 size-6 shrink-0 text-brand-700" aria-hidden />
          <p className="leading-7 text-brand-900">{t.worker.enablePushHint}</p>
        </div>
        <Button
          size="lg"
          className="w-full"
          loading={busy}
          onClick={async () => {
            setBusy(true);
            try {
              const next = await enablePush();
              setState(next);
              if (next === 'subscribed') toast.success(t.worker.pushEnabled);
            } catch (e) {
              toast.error(errorMessage(e));
            } finally {
              setBusy(false);
            }
          }}
        >
          {t.worker.enablePush}
        </Button>
      </Card>
    );
  }

  return (
    <Card className="flex items-start gap-3 border-amber-200 bg-amber-50 p-4 text-amber-900">
      <BellOff className="mt-0.5 size-6 shrink-0" aria-hidden />
      <p className="leading-7">{messages[state]}</p>
    </Card>
  );
}
