import { StatusBadge } from '../components/StatusBadge';
import type { RequestView } from '../lib/types';

/** "أحمد — تم الاستلام" chips: one independent status per worker. */
export function RecipientChips({ request, max = 4 }: { request: RequestView; max?: number }) {
  const shown = request.recipients.slice(0, max);
  const more = request.recipients.length - shown.length;
  return (
    <div className="flex flex-wrap gap-1.5">
      {shown.map((r) => (
        <span key={r.id} className="inline-flex items-center gap-1.5 rounded-full border border-line bg-white py-0.5 pe-1 ps-2.5 text-xs">
          <span className="font-medium">{r.workerName}</span>
          <StatusBadge status={r.status} />
        </span>
      ))}
      {more > 0 && <span className="ltr-nums self-center text-xs text-muted">+{more}</span>}
    </div>
  );
}
