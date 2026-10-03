import { Images, UserRound } from 'lucide-react';
import { Link } from 'react-router-dom';
import { StatusBadge } from '../components/StatusBadge';
import { cx } from '../components/ui';
import { fmt, t } from '../i18n';
import { attachmentUrl } from '../lib/api';
import { formatDateTime, timeAgo } from '../lib/format';
import type { WorkerRequest } from '../lib/types';

/** Worker request card: big image, title, manager, time, status. New ones stand out clearly. */
export function RequestCard({ item, pending }: { item: WorkerRequest; pending?: boolean }) {
  const isNew = item.status === 'NEW' && !item.openedAt;
  const first = item.attachments[0];
  return (
    <Link
      to={`/worker/requests/${item.recipientId}`}
      className={cx(
        'block overflow-hidden rounded-xl border bg-white transition-shadow hover:shadow-md',
        isNew ? 'border-brand-500 ring-2 ring-brand-200' : 'border-line',
      )}
    >
      {isNew && <div className="bg-brand-600 px-4 py-1.5 text-sm font-bold text-white">{t.worker.newBanner}</div>}
      {first && (
        <div className="relative bg-surface">
          <img src={attachmentUrl(first.id, 'thumb')} alt="" loading="lazy" className="max-h-64 w-full object-cover" />
          {item.attachments.length > 1 && (
            <span className="absolute bottom-2 left-2 inline-flex items-center gap-1 rounded-full bg-black/60 px-2 py-0.5 text-xs text-white">
              <Images className="size-3.5" aria-hidden />
              {fmt(t.worker.imagesCount, { n: item.attachments.length })}
            </span>
          )}
        </div>
      )}
      <div className="space-y-2 p-4">
        <div className="flex items-start justify-between gap-3">
          <h3 className="text-lg font-bold leading-7">{item.title}</h3>
          <StatusBadge status={item.status} />
        </div>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted">
          <span className="inline-flex items-center gap-1">
            <UserRound className="size-4" aria-hidden />
            {t.worker.from} {item.managerName}
          </span>
          <span title={formatDateTime(item.sentAt)}>{timeAgo(item.sentAt)}</span>
          {item.editedAt && <span className="text-amber-700">{t.requests.editedLabel}</span>}
          {pending && <span className="font-semibold text-amber-700">{t.worker.pendingSync}</span>}
        </div>
      </div>
    </Link>
  );
}
