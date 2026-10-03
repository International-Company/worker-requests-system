import { ClipboardList, Eye, Images, Pencil, Repeat2, Search, Send, XCircle } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { Button, Card, ConfirmDialog, EmptyState, ErrorBox, IconButton, Input, PageHeader, Pagination, Select, Spinner } from '../components/ui';
import { t } from '../i18n';
import { errorMessage } from '../lib/api';
import { formatDateTime } from '../lib/format';
import type { RequestView } from '../lib/types';
import { OutboxPanel } from './OutboxPanel';
import { useManagers, useRequests, useWorkers } from './queries';
import { RecipientChips } from './RecipientChips';
import { actionText, canCancel, canEdit, type RequestAction, useRequestAction } from './useRequestActions';

/**
 * mode "active": open requests (managers' "الطلبات").
 * mode "history": full searchable log ("سجل الطلبات"; the admin's "الطلبات" page).
 * Filters live in the URL so links like ?workerId=… or ?status=… work.
 */
export function RequestsPage({ mode }: { mode: 'active' | 'history' }) {
  const { user } = useAuth();
  const isAdmin = user?.role === 'SYSTEM_ADMIN';
  const isManager = user?.role === 'MANAGER';
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const [q, setQ] = useState(params.get('q') ?? '');
  const [confirm, setConfirm] = useState<{ action: RequestAction; request: RequestView } | null>(null);
  const act = useRequestAction();
  const workers = useWorkers();
  const managers = useManagers(isAdmin);

  const filters = {
    q: params.get('q') ?? undefined,
    workerId: params.get('workerId') ?? undefined,
    managerId: params.get('managerId') ?? undefined,
    status: params.get('status') ?? undefined,
    from: params.get('from') ?? undefined,
    to: params.get('to') ?? undefined,
    page: Number(params.get('page') ?? 1),
    pageSize: 20,
    view: mode === 'active' ? ('active' as const) : ('all' as const),
  };
  const requests = useRequests(filters);

  // Debounced search box → URL.
  useEffect(() => {
    const id = setTimeout(() => {
      if ((params.get('q') ?? '') !== q.trim()) update({ q: q.trim() || null });
    }, 350);
    return () => clearTimeout(id);
  }, [q]);

  function update(changes: Record<string, string | null>) {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(changes)) {
      if (v) next.set(k, v);
      else next.delete(k);
    }
    if (!('page' in changes)) next.delete('page');
    setParams(next, { replace: true });
  }

  const title = mode === 'active' ? t.requests.activeTitle : isAdmin ? t.nav.requests : t.requests.historyTitle;

  return (
    <div>
      <PageHeader
        title={title}
        actions={
          isManager && (
            <Button icon={<Send className="size-5" />} onClick={() => navigate('/app/requests/new')}>
              {t.dashboard.sendNew}
            </Button>
          )
        }
      />
      {isManager && <OutboxPanel />}

      <Card className="mb-4 grid gap-3 p-3 sm:grid-cols-2 lg:grid-cols-6">
        <div className="relative lg:col-span-2">
          <Search className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-muted" aria-hidden />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t.requests.searchPlaceholder} className="pr-9" aria-label={t.common.search} />
        </div>
        <Select value={filters.workerId ?? ''} onChange={(e) => update({ workerId: e.target.value || null })} aria-label={t.requests.worker}>
          <option value="">{t.requests.anyWorker}</option>
          {workers.data?.map((w) => (
            <option key={w.id} value={w.id}>
              {w.name}
            </option>
          ))}
        </Select>
        {isAdmin ? (
          <Select value={filters.managerId ?? ''} onChange={(e) => update({ managerId: e.target.value || null })} aria-label={t.requests.manager}>
            <option value="">{t.requests.anyManager}</option>
            {managers.data?.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </Select>
        ) : null}
        <Select value={filters.status ?? ''} onChange={(e) => update({ status: e.target.value || null })} aria-label={t.requests.status}>
          <option value="">{t.requests.anyStatus}</option>
          {(['NEW', 'ACKNOWLEDGED', 'COMPLETED', 'CANCELLED'] as const).map((s) => (
            <option key={s} value={s}>
              {t.status[s]}
            </option>
          ))}
        </Select>
        <div className="grid grid-cols-2 gap-2 sm:col-span-2 lg:col-span-2">
          <Input type="date" value={filters.from ?? ''} onChange={(e) => update({ from: e.target.value || null })} aria-label={t.common.from} title={t.common.from} />
          <Input type="date" value={filters.to ?? ''} onChange={(e) => update({ to: e.target.value || null })} aria-label={t.common.to} title={t.common.to} />
        </div>
      </Card>

      {requests.isLoading ? (
        <Spinner />
      ) : requests.isError ? (
        <ErrorBox message={errorMessage(requests.error)} onRetry={() => void requests.refetch()} />
      ) : !requests.data?.items.length ? (
        <EmptyState icon={<ClipboardList className="size-12" />} title={t.requests.noResults} />
      ) : (
        <>
          <Card className="overflow-x-auto">
            <table className="w-full min-w-[52rem] text-right text-sm">
              <thead className="border-b border-line bg-surface text-muted">
                <tr>
                  <th className="px-4 py-3 font-semibold">{t.requests.request}</th>
                  <th className="px-4 py-3 font-semibold">{t.requests.worker} — {t.requests.status}</th>
                  <th className="px-4 py-3 font-semibold">{t.requests.manager}</th>
                  <th className="px-4 py-3 font-semibold">{t.requests.sentAt}</th>
                  <th className="px-4 py-3 font-semibold">{t.common.actions}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {requests.data.items.map((r) => {
                  const own = r.createdBy.id === user?.id;
                  return (
                    <tr key={r.id} className="align-top">
                      <td className="px-4 py-3">
                        <Link to={`/app/requests/${r.id}`} className="font-semibold hover:text-brand-700">
                          <span className="ltr-nums text-muted">#{r.number}</span> {r.title}
                        </Link>
                        <div className="mt-1 flex gap-3 text-xs text-muted">
                          {r.attachments.length > 0 && (
                            <span className="inline-flex items-center gap-1">
                              <Images className="size-3.5" aria-hidden />
                              {r.attachments.length}
                            </span>
                          )}
                          {r.status === 'CANCELLED' && <span className="font-semibold text-slate-600">{t.status.CANCELLED}</span>}
                          {r.editedAt && <span>{t.requests.editedLabel}</span>}
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <RecipientChips request={r} />
                      </td>
                      <td className="px-4 py-3">{r.createdBy.name}</td>
                      <td className="ltr-nums whitespace-nowrap px-4 py-3">{formatDateTime(r.createdAt)}</td>
                      <td className="px-2 py-2">
                        <div className="flex gap-1">
                          <Link
                            to={`/app/requests/${r.id}`}
                            className="inline-flex size-10 items-center justify-center rounded-lg text-muted hover:bg-brand-50 hover:text-brand-700"
                            aria-label={t.requests.details}
                            title={t.requests.details}
                          >
                            <Eye className="size-[18px]" />
                          </Link>
                          {own && canEdit(r) && (
                            <IconButton label={t.common.edit} onClick={() => navigate(`/app/requests/${r.id}/edit`)}>
                              <Pencil className="size-[18px]" />
                            </IconButton>
                          )}
                          {own && (
                            <IconButton label={t.requests.resend} onClick={() => setConfirm({ action: 'resend', request: r })}>
                              <Repeat2 className="size-[18px]" />
                            </IconButton>
                          )}
                          {own && canCancel(r) && (
                            <IconButton label={t.requests.cancelRequest} className="hover:text-red-700" onClick={() => setConfirm({ action: 'cancel', request: r })}>
                              <XCircle className="size-[18px]" />
                            </IconButton>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </Card>
          <Pagination page={filters.page} pageSize={filters.pageSize} total={requests.data.total} onPage={(p) => update({ page: String(p) })} />
        </>
      )}

      <ConfirmDialog
        open={Boolean(confirm)}
        title={confirm ? actionText[confirm.action].title : ''}
        message={confirm ? actionText[confirm.action].confirm : ''}
        confirmLabel={t.common.confirm}
        danger={confirm?.action === 'cancel'}
        loading={act.isPending}
        onClose={() => setConfirm(null)}
        onConfirm={() => confirm && act.mutate(confirm, { onSettled: () => setConfirm(null) })}
      />
    </div>
  );
}
