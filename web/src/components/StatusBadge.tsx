import { CheckCheck, CircleDot, Hand, XCircle } from 'lucide-react';
import { t } from '../i18n';
import type { RecipientStatus } from '../lib/types';
import { cx } from './ui';

const styles: Record<RecipientStatus, string> = {
  NEW: 'bg-brand-50 text-brand-700 ring-brand-200',
  ACKNOWLEDGED: 'bg-amber-50 text-amber-800 ring-amber-200',
  COMPLETED: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  CANCELLED: 'bg-slate-100 text-slate-600 ring-slate-200',
};
const icons: Record<RecipientStatus, typeof CircleDot> = {
  NEW: CircleDot,
  ACKNOWLEDGED: Hand,
  COMPLETED: CheckCheck,
  CANCELLED: XCircle,
};

export function StatusBadge({ status, large }: { status: RecipientStatus; large?: boolean }) {
  const Icon = icons[status];
  return (
    <span
      className={cx(
        'inline-flex items-center gap-1 whitespace-nowrap rounded-full font-semibold ring-1 ring-inset',
        large ? 'px-3 py-1 text-sm' : 'px-2 py-0.5 text-xs',
        styles[status],
      )}
    >
      <Icon className={large ? 'size-4' : 'size-3.5'} aria-hidden />
      {t.status[status]}
    </span>
  );
}
