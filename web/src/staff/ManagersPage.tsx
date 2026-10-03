import { useMutation, useQueryClient } from '@tanstack/react-query';
import { KeyRound, LogOut, Pencil, Power, ShieldCheck, Trash2, UserPlus } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useAuth } from '../auth/AuthContext';
import { useToast } from '../components/Toast';
import { Button, Card, ConfirmDialog, cx, Dialog, EmptyState, ErrorBox, Field, IconButton, Input, PageHeader, Select, Spinner } from '../components/ui';
import { t } from '../i18n';
import { ApiError, del, errorMessage, patch, post } from '../lib/api';
import { formatDateTime, timeAgo } from '../lib/format';
import type { StaffAccount } from '../lib/types';
import { PinDialog } from './PinDialog';
import { useManagers } from './queries';

type Pending = { kind: 'toggle' | 'disconnect' | 'delete'; account: StaffAccount } | null;

export function ManagersPage() {
  const { user } = useAuth();
  const toast = useToast();
  const qc = useQueryClient();
  const managers = useManagers();
  const [form, setForm] = useState<{ open: boolean; account?: StaffAccount }>({ open: false });
  const [pinFor, setPinFor] = useState<StaffAccount | null>(null);
  const [pending, setPending] = useState<Pending>(null);

  const action = useMutation({
    mutationFn: async (p: NonNullable<Pending>) => {
      if (p.kind === 'toggle') return patch(`/managers/${p.account.id}`, { isActive: !p.account.isActive });
      if (p.kind === 'disconnect') return post(`/managers/${p.account.id}/disconnect-device`);
      return del(`/managers/${p.account.id}`);
    },
    onSuccess: () => {
      toast.success(t.common.saved);
      setPending(null);
      void qc.invalidateQueries({ queryKey: ['managers'] });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  return (
    <div>
      <PageHeader
        title={t.managers.title}
        actions={
          <Button icon={<UserPlus className="size-5" />} onClick={() => setForm({ open: true })}>
            {t.managers.add}
          </Button>
        }
      />
      {managers.isLoading ? (
        <Spinner />
      ) : managers.isError ? (
        <ErrorBox message={errorMessage(managers.error)} onRetry={() => void managers.refetch()} />
      ) : !managers.data?.length ? (
        <EmptyState icon={<ShieldCheck className="size-12" />} title={t.managers.empty} />
      ) : (
        <Card className="overflow-x-auto">
          <table className="w-full min-w-[40rem] text-right text-sm">
            <thead className="border-b border-line bg-surface text-muted">
              <tr>
                <th className="px-4 py-3 font-semibold">{t.requests.manager}</th>
                <th className="px-4 py-3 font-semibold">{t.workers.status}</th>
                <th className="px-4 py-3 font-semibold">{t.managers.lastLogin}</th>
                <th className="px-4 py-3 font-semibold">{t.common.actions}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {managers.data.map((m) => {
                const self = m.id === user?.id;
                return (
                  <tr key={m.id} className={cx(!m.isActive && 'text-muted')}>
                    <td className="px-4 py-3">
                      <p className="font-semibold">
                        {m.name} {self && <span className="text-xs text-muted">{t.managers.you}</span>}
                      </p>
                      <p className="text-xs text-muted">{t.roles[m.role]}</p>
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={cx(
                          'inline-flex rounded-full px-2.5 py-0.5 text-xs font-semibold',
                          m.isActive ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-600',
                        )}
                      >
                        {m.isActive ? t.workers.active : t.workers.inactive}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <p className="ltr-nums">{formatDateTime(m.lastLoginAt)}</p>
                      {m.lastActivityAt && (
                        <p className="text-xs text-muted">
                          {t.managers.lastActivity}: {timeAgo(m.lastActivityAt)}
                        </p>
                      )}
                    </td>
                    <td className="px-2 py-2">
                      <div className="flex flex-wrap gap-1">
                        <IconButton label={t.common.edit} onClick={() => setForm({ open: true, account: m })}>
                          <Pencil className="size-[18px]" />
                        </IconButton>
                        <IconButton label={t.workers.changePin} onClick={() => setPinFor(m)}>
                          <KeyRound className="size-[18px]" />
                        </IconButton>
                        {!self && (
                          <>
                            <IconButton label={m.isActive ? t.workers.deactivate : t.workers.activate} onClick={() => setPending({ kind: 'toggle', account: m })}>
                              <Power className={cx('size-[18px]', !m.isActive && 'text-emerald-600')} />
                            </IconButton>
                            <IconButton
                              label={t.managers.disconnect}
                              disabled={m.activeSessions === 0}
                              className="disabled:opacity-30"
                              onClick={() => setPending({ kind: 'disconnect', account: m })}
                            >
                              <LogOut className="size-[18px]" />
                            </IconButton>
                            <IconButton label={t.workers.delete} className="hover:text-red-700" onClick={() => setPending({ kind: 'delete', account: m })}>
                              <Trash2 className="size-[18px]" />
                            </IconButton>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Card>
      )}

      <ManagerFormDialog open={form.open} account={form.account} selfId={user?.id} onClose={() => setForm({ open: false })} />
      <PinDialog open={Boolean(pinFor)} name={pinFor?.name ?? ''} path={pinFor ? `/managers/${pinFor.id}/change-pin` : ''} onClose={() => setPinFor(null)} />
      <ConfirmDialog
        open={Boolean(pending)}
        title={pending?.kind === 'disconnect' ? t.managers.disconnect : pending?.kind === 'delete' ? t.workers.delete : t.workers.deactivate}
        message={
          pending?.kind === 'disconnect'
            ? t.managers.disconnectConfirm
            : pending?.kind === 'delete'
              ? t.managers.deleteConfirm
              : `${pending?.account.isActive ? t.workers.deactivate : t.workers.activate} ${pending?.account.name ?? ''}؟`
        }
        confirmLabel={t.common.confirm}
        danger
        loading={action.isPending}
        onClose={() => setPending(null)}
        onConfirm={() => pending && action.mutate(pending)}
      />
    </div>
  );
}

function ManagerFormDialog({ open, account, selfId, onClose }: { open: boolean; account?: StaffAccount; selfId?: string; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [name, setName] = useState('');
  const [pin, setPin] = useState('');
  const [role, setRole] = useState<'MANAGER' | 'SYSTEM_ADMIN'>('MANAGER');
  const [isActive, setIsActive] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setName(account?.name ?? '');
    setRole(account?.role ?? 'MANAGER');
    setIsActive(account?.isActive ?? true);
    setPin('');
    setError(null);
  }, [open, account]);

  const save = useMutation({
    mutationFn: () => (account ? patch(`/managers/${account.id}`, { name, role, isActive }) : post('/managers', { name, pin, role, isActive })),
    onSuccess: () => {
      toast.success(account ? t.common.saved : t.managers.created);
      void qc.invalidateQueries({ queryKey: ['managers'] });
      onClose();
    },
    onError: (e) => setError(e instanceof ApiError && Array.isArray(e.details) ? (e.details as string[]).join('، ') : errorMessage(e)),
  });
  const self = account?.id === selfId;
  const valid = name.trim().length >= 2 && (account || /^\d{4}$/.test(pin));

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={account ? t.managers.edit : t.managers.add}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t.common.cancel}
          </Button>
          <Button onClick={() => save.mutate()} loading={save.isPending} disabled={!valid}>
            {t.common.save}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label={t.managers.name}>{(id) => <Input id={id} value={name} onChange={(e) => setName(e.target.value)} maxLength={120} />}</Field>
        {!account && (
          <Field label={t.workers.pin} hint={t.workers.pinHint}>
            {(id) => (
              <Input
                id={id}
                value={pin}
                onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 4))}
                inputMode="numeric"
                autoComplete="off"
                dir="ltr"
                className="ltr-nums text-center text-xl tracking-[0.5em]"
              />
            )}
          </Field>
        )}
        <Field label={t.managers.role}>
          {(id) => (
            <Select id={id} value={role} disabled={self} onChange={(e) => setRole(e.target.value as typeof role)}>
              <option value="MANAGER">{t.roles.MANAGER}</option>
              <option value="SYSTEM_ADMIN">{t.roles.SYSTEM_ADMIN}</option>
            </Select>
          )}
        </Field>
        {!self && (
          <label className="flex items-center gap-3">
            <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} className="size-5 accent-brand-600" />
            <span className="font-medium">{t.workers.active}</span>
          </label>
        )}
        {error && (
          <p className="rounded-lg bg-red-50 p-3 text-sm text-red-800" role="alert">
            {error}
          </p>
        )}
      </div>
    </Dialog>
  );
}
