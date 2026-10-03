import { RefreshCw, WifiOff } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useOnline } from '../hooks/useOnline';
import { t } from '../i18n';
import { applyUpdate, onNeedRefresh } from '../pwa/sw-bridge';
import { Button } from './ui';

/** Offline indicator + "new version available" (service worker update) banner. */
export function AppBanners() {
  const online = useOnline();
  const [updateReady, setUpdateReady] = useState(false);
  useEffect(() => onNeedRefresh(() => setUpdateReady(true)), []);

  return (
    <>
      {!online && (
        <div className="flex items-center justify-center gap-2 bg-amber-100 px-3 py-2 text-center text-sm font-medium text-amber-900" role="status">
          <WifiOff className="size-4 shrink-0" aria-hidden />
          {t.common.offline}
        </div>
      )}
      {updateReady && (
        <div className="flex flex-wrap items-center justify-center gap-3 bg-brand-700 px-3 py-2 text-sm text-white" role="status">
          <span>{t.common.updateAvailable}</span>
          <Button size="sm" variant="secondary" icon={<RefreshCw className="size-4" />} onClick={applyUpdate}>
            {t.common.updateNow}
          </Button>
        </div>
      )}
    </>
  );
}
