import { useEffect, useState } from 'react';
import { t } from '../i18n';
import { timeAgo } from '../lib/format';
import { cx } from './ui';

/** "متصل" or "آخر اتصال منذ 4 دقائق" — re-renders every 30 s. */
export function PresenceLabel({ online, lastSeenAt, hasDevice = true }: { online: boolean; lastSeenAt: string | null; hasDevice?: boolean }) {
  const [, tick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => tick((n) => n + 1), 30_000);
    return () => clearInterval(id);
  }, []);
  return (
    <span className="inline-flex items-center gap-1.5 text-sm">
      <span className={cx('size-2.5 rounded-full', online ? 'bg-emerald-500' : 'bg-slate-300')} aria-hidden />
      {online ? (
        <span className="font-semibold text-emerald-700">{t.presence.online}</span>
      ) : (
        <span className="text-muted">
          {!hasDevice && !lastSeenAt ? t.presence.noDevice : `${t.presence.lastSeen} ${timeAgo(lastSeenAt)}`}
        </span>
      )}
    </span>
  );
}
