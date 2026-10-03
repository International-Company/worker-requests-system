import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ClipboardList, KeyRound, Pencil, Power, Search, Smartphone, Trash2, UserPlus, Users } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { PresenceLabel } from '../components/Presence';
import { useToast } from '../components/Toast';
import { Button, Card, ConfirmDialog, cx, EmptyState, ErrorBox, IconButton, Input, PageHeader, Spinner } from '../components/ui';
import { t } from '../i18n';
import { del, errorMessage, patch, post, workerPhotoUrl } from '../lib/api';
import type { Worker } from '../lib/types';
import { PinDialog } from './PinDialog';
import { useWorkers } from './queries';
import { WorkerFormDialog } from './WorkerFormDialog';

type Pending = { kind: 'toggle' | 'disconnect' | 'delete'; worker: Worker } | null;

export function WorkersPage() {
  const { user } = useAuth();
  const toast = useToast();
  const qc = useQueryClient();
  const workers = useWorkers();
  const [q, setQ] = useState('');
  const [form, setForm] = useState<{ open: boolean; worker?: Worker }>({ open: false });
  const [pinFor, setPinFor] = useState<Worker | null>(null);
  const [pending, setPending] = useState<Pending>(null);
  const isAdmin = user?.role === 'SYSTEM_ADMIN';
  const historyBase = isAdmin ? '/app/requests' : '/app/history';

  const filtered = useMemo(
    () => (workers.data ?? []).filter((w) => !q || w.name.includes(q.trim()) || w.phone.includes(q.trim())),
    [workers.data, q],
  );

  const action = useMutation({
    mutationFn: async (p: NonNullable<Pending>) => {
      if (p.kind === 'toggle') return patch(`/workers/${p.worker.id}`, { isActive: !p.worker.isActive });
      if (p.kind === 'disconnect') return post(`/workers/${p.worker.id}/disconnect-device`);
      return del(`/workers/${p.worker.id}`);
    },
    onSuccess: (_d, p) => {
      toast.success(p.kind === 'disconnect' ? t.workers.disconnected : t.workers.updated);
      setPending(null);
      void qc.invalidateQueries({ queryKey: ['workers'] });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  return (
    <div>
      <PageHeader
        title={t.workers.title}
        actions={
          <Button icon={<UserPlus className="size-5" />} onClick={() => setForm({ open: true })}>
            {t.workers.add}
          </Button>
        }
      />
      <div className="relative mb-4 max-w-sm">
        <Search className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-muted" aria-hidden />
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t.workers.searchPlaceholder} className="pr-9" aria-label={t.common.search} />
      </div>

      {workers.isLoading ? (
        <Spinner />
      ) : workers.isError ? (
        <ErrorBox message={errorMessage(workers.error)} onRetry={() => void workers.refetch()} />
      ) : filtered.length === 0 ? (
        <EmptyState icon={<Users className="size-12" />} title={t.workers.empty} />
      ) : (
        <>
          {/* Desktop table */}
          <Card className="hidden overflow-x-auto md:block">
            <table className="w-full text-right text-sm">
              <thead className="border-b border-line bg-surface text-muted">
                <tr>
                  <th className="px-4 py-3 font-semibold">{t.requests.worker}</th>
                  <th className="px-4 py-3 font-semibold">{t.workers.photo}</th>
                  <th className="px-4 py-3 font-semibold">{t.workers.phone}</th>
                  <th className="px-4 py-3 font-semibold">{t.workers.status}</th>
                  <th className="px-4 py-3 font-semibold">{t.workers.lastSeen}</th>
                  <th className="px-4 py-3 font-semibold">{t.common.actions}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {filtered.map((w) => (
                  <tr key={w.id} className={cx(!w.isActive && 'bg-surface/60 text-muted')}>
                    <td className="px-4 py-3 font-semibold">{w.name}</td>
                    <td className="px-4 py-2">
                      <Avatar worker={w} />
                    </td>
                    <td className="ltr-nums px-4 py-3" dir="ltr">
                      {w.phone}
                    </td>
                    <td className="px-4 py-3">
                      <ActiveBadge active={w.isActive} />
                    </td>
                    <td className="px-4 py-3">
                      <PresenceLabel online={w.isOnline} lastSeenAt={w.lastSeenAt} hasDevice={Boolean(w.device)} />
                    </td>
                    <td className="px-2 py-2">
                      <Actions
                        worker={w}
                        isAdmin={isAdmin}
                        historyBase={historyBase}
                        onEdit={() => setForm({ open: true, worker: w })}
                        onPin={() => setPinFor(w)}
                        onPending={(kind) => setPending({ kind, worker: w })}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>

          {/* Phone cards — no hover-only controls */}
          <div className="space-y-3 md:hidden">
            {filtered.map((w) => (
              <Card key={w.id} className="space-y-3 p-4">
                <div className="flex items-center gap-3">
                  <Avatar worker={w} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-bold">{w.name}</p>
                    <p className="ltr-nums text-sm text-muted" dir="ltr">
                      {w.phone}
                    </p>
                  </div>
                  <ActiveBadge active={w.isActive} />
                </div>
                <PresenceLabel online={w.isOnline} lastSeenAt={w.lastSeenAt} hasDevice={Boolean(w.device)} />
                <Actions
                  worker={w}
                  isAdmin={isAdmin}
                  historyBase={historyBase}
                  onEdit={() => setForm({ open: true, worker: w })}
                  onPin={() => setPinFor(w)}
                  onPending={(kind) => setPending({ kind, worker: w })}
                />
              </Card>
            ))}
          </div>
        </>
      )}

      <WorkerFormDialog open={form.open} worker={form.worker} onClose={() => setForm({ open: false })} />
      <PinDialog
        open={Boolean(pinFor)}
        name={pinFor?.name ?? ''}
        path={pinFor ? `/workers/${pinFor.id}/change-pin` : ''}
        onClose={() => setPinFor(null)}
      />
      <ConfirmDialog
        open={Boolean(pending)}
        title={
          pending?.kind === 'disconnect'
            ? t.workers.disconnect
            : pending?.kind === 'delete'
              ? t.workers.delete
              : pending?.worker.isActive
                ? t.workers.deactivate
                : t.workers.activate
        }
        message={
          pending?.kind === 'disconnect'
            ? t.workers.disconnectConfirm
            : pending?.kind === 'delete'
              ? t.workers.deleteConfirm
              : pending?.worker.isActive
                ? t.workers.deactivateConfirm
                : `${t.workers.activate} ${pending?.worker.name ?? ''}؟`
        }
        confirmLabel={t.common.confirm}
        danger={pending?.kind !== 'toggle' || pending.worker.isActive}
        loading={action.isPending}
        onClose={() => setPending(null)}
        onConfirm={() => pending && action.mutate(pending)}
      />
    </div>
  );
}

function Avatar({ worker }: { worker: Worker }) {
  return worker.photoVersion ? (
    <img src={workerPhotoUrl(worker.id, worker.photoVersion)} alt="" className="size-10 rounded-full object-cover" loading="lazy" />
  ) : (
    <div className="flex size-10 items-center justify-center rounded-full bg-brand-100 font-bold text-brand-700">{worker.name.slice(0, 1)}</div>
  );
}

function ActiveBadge({ active }: { active: boolean }) {
  return (
    <span
      className={cx(
        'inline-flex rounded-full px-2.5 py-0.5 text-xs font-semibold',
        active ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-600',
      )}
    >
      {active ? t.workers.active : t.workers.inactive}
    </span>
  );
}

function Actions({
  worker,
  isAdmin,
  historyBase,
  onEdit,
  onPin,
  onPending,
}: {
  worker: Worker;
  isAdmin: boolean;
  historyBase: string;
  onEdit: () => void;
  onPin: () => void;
  onPending: (kind: 'toggle' | 'disconnect' | 'delete') => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-1">
      <IconButton label={t.common.edit} onClick={onEdit}>
        <Pencil className="size-[18px]" />
      </IconButton>
      <IconButton label={t.workers.changePin} onClick={onPin}>
        <KeyRound className="size-[18px]" />
      </IconButton>
      <IconButton label={worker.isActive ? t.workers.deactivate : t.workers.activate} onClick={() => onPending('toggle')}>
        <Power className={cx('size-[18px]', !worker.isActive && 'text-emerald-600')} />
      </IconButton>
      <IconButton label={t.workers.disconnect} onClick={() => onPending('disconnect')} disabled={!worker.device} className="disabled:opacity-30">
        <Smartphone className="size-[18px]" />
      </IconButton>
      <Link
        to={`${historyBase}?workerId=${worker.id}`}
        title={t.workers.viewRequests}
        aria-label={t.workers.viewRequests}
        className="inline-flex size-10 items-center justify-center rounded-lg text-muted hover:bg-brand-50 hover:text-brand-700"
      >
        <ClipboardList className="size-[18px]" />
      </Link>
      {isAdmin && (
        <IconButton label={t.workers.delete} onClick={() => onPending('delete')} className="hover:text-red-700">
          <Trash2 className="size-[18px]" />
        </IconButton>
      )}
    </div>
  );
}
