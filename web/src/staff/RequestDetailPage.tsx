import { ArrowRight, Pencil, Repeat2, RotateCcw, XCircle } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { Gallery } from '../components/Gallery';
import { StatusBadge } from '../components/StatusBadge';
import { Button, Card, ConfirmDialog, ErrorBox, Spinner } from '../components/ui';
import { t } from '../i18n';
import { errorMessage } from '../lib/api';
import { formatDateTime } from '../lib/format';
import type { NotificationRow, Recipient } from '../lib/types';
import { useRequest } from './queries';
import { actionText, canCancel, canEdit, canReopen, type RequestAction, useRequestAction } from './useRequestActions';

export function RequestDetailPage() {
  const { id } = useParams();
  const { user } = useAuth();
  const navigate = useNavigate();
  const query = useRequest(id);
  const act = useRequestAction();
  const [confirm, setConfirm] = useState<{ action: RequestAction; recipientIds?: string[] } | null>(null);

  if (query.isLoading) return <Spinner />;
  if (query.isError || !query.data) return <ErrorBox message={errorMessage(query.error)} onRetry={() => void query.refetch()} />;
  const r = query.data;
  const own = r.createdBy.id === user?.id;
  const notificationsFor = (rc: Recipient) => r.notifications.filter((n) => n.recipientId === rc.id);

  return (
    <div className="space-y-5">
      <button type="button" onClick={() => navigate(-1)} className="inline-flex items-center gap-1 text-brand-700">
        <ArrowRight className="size-5" aria-hidden />
        {t.common.back}
      </button>

      <Card className="p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="space-y-1">
            <h1 className="text-2xl font-bold">
              <span className="ltr-nums text-muted">#{r.number}</span> {r.title}
            </h1>
            <p className="text-sm text-muted">
              {t.requests.manager}: <span className="text-ink">{r.createdBy.name}</span> · {t.requests.sentAt}:{' '}
              <span className="ltr-nums text-ink">{formatDateTime(r.createdAt)}</span>
              {r.editedAt && (
                <>
                  {' '}
                  · {t.requests.editedLabel}: <span className="ltr-nums">{formatDateTime(r.editedAt)}</span>
                </>
              )}
            </p>
            {r.resentFromId && (
              <Link to={`/app/requests/${r.resentFromId}`} className="text-sm text-brand-700 hover:underline">
                {t.requests.resentFrom}
              </Link>
            )}
            {r.status === 'CANCELLED' && (
              <p className="text-sm font-semibold text-slate-600">
                {t.status.CANCELLED} — <span className="ltr-nums">{formatDateTime(r.cancelledAt)}</span>
              </p>
            )}
          </div>
          {own && (
            <div className="flex flex-wrap gap-2">
              {canEdit(r) && (
                <Button variant="secondary" icon={<Pencil className="size-4" />} onClick={() => navigate(`/app/requests/${r.id}/edit`)}>
                  {t.common.edit}
                </Button>
              )}
              {canReopen(r) && (
                <Button variant="secondary" icon={<RotateCcw className="size-4" />} onClick={() => setConfirm({ action: 'reopen' })}>
                  {t.requests.reopen}
                </Button>
              )}
              <Button variant="secondary" icon={<Repeat2 className="size-4" />} onClick={() => setConfirm({ action: 'resend' })}>
                {t.requests.resend}
              </Button>
              {canCancel(r) && (
                <Button variant="danger" icon={<XCircle className="size-4" />} onClick={() => setConfirm({ action: 'cancel' })}>
                  {t.requests.cancelRequest}
                </Button>
              )}
            </div>
          )}
        </div>
        {r.attachments.length > 0 ? (
          <div className="mt-4 max-w-xl">
            <Gallery images={r.attachments} compact />
          </div>
        ) : (
          <p className="mt-3 text-sm text-muted">{t.requests.noImages}</p>
        )}
      </Card>

      <Card className="overflow-x-auto">
        <h2 className="border-b border-line px-4 py-3 font-bold">{t.requests.timeline}</h2>
        <table className="w-full min-w-[56rem] text-right text-sm">
          <thead className="border-b border-line bg-surface text-muted">
            <tr>
              <th className="px-4 py-2.5 font-semibold">{t.requests.worker}</th>
              <th className="px-4 py-2.5 font-semibold">{t.requests.status}</th>
              <th className="px-4 py-2.5 font-semibold">{t.requests.delivered}</th>
              <th className="px-4 py-2.5 font-semibold">{t.requests.opened}</th>
              <th className="px-4 py-2.5 font-semibold">{t.requests.acknowledgedAt}</th>
              <th className="px-4 py-2.5 font-semibold">{t.requests.completedAt}</th>
              <th className="px-4 py-2.5 font-semibold">{t.requests.notifications}</th>
              {own && <th className="px-4 py-2.5" />}
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {r.recipients.map((rc) => (
              <tr key={rc.id} className="align-top">
                <td className="whitespace-nowrap px-4 py-3 font-semibold">{rc.workerName}</td>
                <td className="px-4 py-3">
                  <StatusBadge status={rc.status} />
                  {rc.reopenedAt && (
                    <p className="mt-1 text-xs text-muted">
                      {t.requests.reopenedAt}: <span className="ltr-nums">{formatDateTime(rc.reopenedAt)}</span>
                    </p>
                  )}
                  {rc.cancelledAt && <p className="ltr-nums mt-1 text-xs text-muted">{formatDateTime(rc.cancelledAt)}</p>}
                </td>
                <Time v={rc.deliveredAt} />
                <Time v={rc.openedAt} />
                <Time v={rc.acknowledgedAt} />
                <Time v={rc.completedAt} />
                <td className="px-4 py-3">
                  <NotificationLog rows={notificationsFor(rc)} />
                </td>
                {own && (
                  <td className="px-2 py-2">
                    {rc.status === 'COMPLETED' && r.status === 'ACTIVE' && (
                      <Button size="sm" variant="ghost" icon={<RotateCcw className="size-4" />} onClick={() => setConfirm({ action: 'reopen', recipientIds: [rc.id] })}>
                        {t.requests.reopen}
                      </Button>
                    )}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      <ConfirmDialog
        open={Boolean(confirm)}
        title={confirm ? actionText[confirm.action].title : ''}
        message={confirm ? actionText[confirm.action].confirm : ''}
        confirmLabel={t.common.confirm}
        danger={confirm?.action === 'cancel'}
        loading={act.isPending}
        onClose={() => setConfirm(null)}
        onConfirm={() => confirm && act.mutate({ ...confirm, request: r }, { onSettled: () => setConfirm(null) })}
      />
    </div>
  );
}

function Time({ v }: { v: string | null }) {
  return <td className="ltr-nums whitespace-nowrap px-4 py-3">{formatDateTime(v)}</td>;
}

function NotificationLog({ rows }: { rows: NotificationRow[] }) {
  if (!rows.length) return <span className="text-muted">{t.common.none}</span>;
  return (
    <ul className="space-y-1 text-xs">
      {rows.map((n) => (
        <li key={n.id} className="flex flex-wrap gap-x-1.5">
          <span className="font-semibold">{t.notificationType[n.type]}</span>
          <span className={n.status === 'FAILED' ? 'text-red-700' : n.status === 'SKIPPED' ? 'text-amber-700' : 'text-emerald-700'}>
            {t.notificationStatus[n.status]}
          </span>
          {n.error && t.notificationError[n.error] && <span className="text-muted">({t.notificationError[n.error]})</span>}
          <span className="ltr-nums text-muted">{formatDateTime(n.deliveredAt ?? n.sentAt ?? n.createdAt).split(' ').pop()}</span>
        </li>
      ))}
    </ul>
  );
}
