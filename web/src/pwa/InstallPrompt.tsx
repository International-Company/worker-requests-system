import { Download, Share, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Button, IconButton } from '../components/ui';
import { t } from '../i18n';
import { isIos, isStandalone } from '../lib/device';

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

const DISMISS_KEY = 'wr.installDismissedAt';
const DISMISS_FOR_MS = 3 * 24 * 3600 * 1000;

/** Offers PWA installation when the browser allows it (Android/desktop), or explains it on iOS. */
export function InstallPrompt() {
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);
  const [showIos, setShowIos] = useState(false);
  const [hidden, setHidden] = useState(() => {
    const at = Number(localStorage.getItem(DISMISS_KEY) ?? 0);
    return Date.now() - at < DISMISS_FOR_MS;
  });

  useEffect(() => {
    if (isStandalone()) return;
    const onPrompt = (e: Event) => {
      e.preventDefault();
      setDeferred(e as BeforeInstallPromptEvent);
    };
    const onInstalled = () => setDeferred(null);
    window.addEventListener('beforeinstallprompt', onPrompt);
    window.addEventListener('appinstalled', onInstalled);
    if (isIos()) setShowIos(true);
    return () => {
      window.removeEventListener('beforeinstallprompt', onPrompt);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, []);

  if (hidden || isStandalone() || (!deferred && !showIos)) return null;

  const dismiss = () => {
    localStorage.setItem(DISMISS_KEY, String(Date.now()));
    setHidden(true);
  };

  return (
    <div className="mb-4 flex items-start gap-3 rounded-lg border border-brand-200 bg-brand-50 p-3 text-brand-900">
      {deferred ? <Download className="mt-0.5 size-5 shrink-0" aria-hidden /> : <Share className="mt-0.5 size-5 shrink-0" aria-hidden />}
      <div className="flex-1 space-y-2 text-sm leading-6">
        <p>{deferred ? t.pwa.installHint : t.pwa.iosInstall}</p>
        {deferred && (
          <Button
            size="sm"
            onClick={async () => {
              await deferred.prompt();
              await deferred.userChoice;
              setDeferred(null);
            }}
          >
            {t.pwa.install}
          </Button>
        )}
      </div>
      <IconButton label={t.pwa.later} onClick={dismiss} className="size-8">
        <X className="size-4" />
      </IconButton>
    </div>
  );
}
