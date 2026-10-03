import { useQuery } from '@tanstack/react-query';
import { FileClock, LogIn } from 'lucide-react';
import { useState } from 'react';
import { Card, EmptyState, ErrorBox, PageHeader, Pagination, Select, Spinner } from '../components/ui';
import { t } from '../i18n';
import { errorMessage, get, qs } from '../lib/api';
import { formatDateTime, timeAgo } from '../lib/format';
import type { AuditLogRow, LoginLogRow, Paged } from '../lib/types';

export function LoginLogsPage() {
  const [page, setPage] = useState(1);
  const [role, setRole] = useState('');
  const logs = useQuery({
    queryKey: ['logins', page, role],
    queryFn: () => get<Paged<LoginLogRow>>(`/logs/logins${qs({ page, pageSize: 25, role })}`),
    placeholderData: (p) => p,
  });

  return (
    <div>
      <PageHeader
        title={t.logs.loginTitle}
        actions={
          <Select value={role} onChange={(e) => (setRole(e.target.value), setPage(1))} className="w-44" aria-label={t.logs.role}>
            <option value="">{t.common.all}</option>
            {(['SYSTEM_ADMIN', 'MANAGER', 'WORKER'] as const).map((r) => (
              <option key={r} value={r}>
                {t.roles[r]}
              </option>
            ))}
          </Select>
        }
      />
      {logs.isLoading ? (
        <Spinner />
      ) : logs.isError ? (
        <ErrorBox message={errorMessage(logs.error)} />
      ) : !logs.data?.items.length ? (
        <EmptyState icon={<LogIn className="size-12" />} title={t.logs.empty} />
      ) : (
        <>
          <Card className="overflow-x-auto">
            <table className="w-full min-w-[48rem] text-right text-sm">
              <thead className="border-b border-line bg-surface text-muted">
                <tr>
                  <th className="px-4 py-3 font-semibold">{t.logs.user}</th>
                  <th className="px-4 py-3 font-semibold">{t.logs.role}</th>
                  <th className="px-4 py-3 font-semibold">{t.logs.time}</th>
                  <th className="px-4 py-3 font-semibold">{t.logs.device}</th>
                  <th className="px-4 py-3 font-semibold">{t.logs.lastActivity}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {logs.data.items.map((l) => {
                  const active = l.session && !l.session.revokedAt && new Date(l.session.expiresAt) > new Date();
                  return (
                    <tr key={l.id}>
                      <td className="px-4 py-3 font-semibold">{l.user.name}</td>
                      <td className="px-4 py-3">{t.roles[l.role]}</td>
                      <td className="ltr-nums whitespace-nowrap px-4 py-3">{formatDateTime(l.createdAt)}</td>
                      <td className="px-4 py-3">
                        <p className="max-w-64 truncate" title={l.userAgent ?? ''}>
                          {l.userAgent ? summarizeUa(l.userAgent) : t.common.none}
                        </p>
                        <p className="ltr-nums text-xs text-muted" dir="ltr">
                          {l.deviceKey?.slice(0, 8)} · {l.ip}
                        </p>
                      </td>
                      <td className="px-4 py-3">
                        <p>{l.session ? timeAgo(l.session.lastUsedAt) : t.common.none}</p>
                        <p className={active ? 'text-xs text-emerald-700' : 'text-xs text-muted'}>{active ? t.logs.sessionActive : t.logs.sessionEnded}</p>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </Card>
          <Pagination page={page} pageSize={25} total={logs.data.total} onPage={setPage} />
        </>
      )}
    </div>
  );
}

export function AuditLogPage() {
  const [page, setPage] = useState(1);
  const [action, setAction] = useState('');
  const logs = useQuery({
    queryKey: ['audit', page, action],
    queryFn: () => get<Paged<AuditLogRow>>(`/logs/audit${qs({ page, pageSize: 25, action })}`),
    placeholderData: (p) => p,
  });

  return (
    <div>
      <PageHeader
        title={t.logs.auditTitle}
        actions={
          <Select value={action} onChange={(e) => (setAction(e.target.value), setPage(1))} className="w-56" aria-label={t.logs.action}>
            <option value="">{t.common.all}</option>
            {Object.entries(t.audit).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </Select>
        }
      />
      {logs.isLoading ? (
        <Spinner />
      ) : logs.isError ? (
        <ErrorBox message={errorMessage(logs.error)} />
      ) : !logs.data?.items.length ? (
        <EmptyState icon={<FileClock className="size-12" />} title={t.logs.empty} />
      ) : (
        <>
          <Card className="overflow-x-auto">
            <table className="w-full min-w-[48rem] text-right text-sm">
              <thead className="border-b border-line bg-surface text-muted">
                <tr>
                  <th className="px-4 py-3 font-semibold">{t.logs.at}</th>
                  <th className="px-4 py-3 font-semibold">{t.logs.actor}</th>
                  <th className="px-4 py-3 font-semibold">{t.logs.action}</th>
                  <th className="px-4 py-3 font-semibold">{t.logs.details}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {logs.data.items.map((l) => (
                  <tr key={l.id} className="align-top">
                    <td className="ltr-nums whitespace-nowrap px-4 py-3">{formatDateTime(l.createdAt)}</td>
                    <td className="px-4 py-3">
                      {l.actor?.name ?? t.common.none}
                      {l.actorRole && <p className="text-xs text-muted">{t.roles[l.actorRole]}</p>}
                    </td>
                    <td className="px-4 py-3 font-semibold">{t.audit[l.action] ?? l.action}</td>
                    <td className="px-4 py-3">
                      <AuditDetails metadata={l.metadata} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
          <Pagination page={page} pageSize={25} total={logs.data.total} onPage={setPage} />
        </>
      )}
    </div>
  );
}

/** Shows the meaningful fields in Arabic; technical ids are omitted. */
function AuditDetails({ metadata }: { metadata: Record<string, unknown> | null }) {
  if (!metadata) return null;
  const rows = Object.entries(metadata)
    .filter(([k, v]) => t.auditFields[k] && v !== null && v !== undefined)
    .map(([k, v]) => [t.auditFields[k], formatValue(k, v)] as const);
  if (!rows.length) return <span className="text-muted">{t.common.none}</span>;
  return (
    <dl className="space-y-0.5 text-xs">
      {rows.map(([label, value]) => (
        <div key={label} className="flex gap-1.5">
          <dt className="text-muted">{label}:</dt>
          <dd className="text-ink">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

function formatValue(key: string, v: unknown): string {
  if (typeof v === 'boolean') return v ? t.common.yes : t.common.no;
  if (key === 'targetType' && typeof v === 'string') return t.targetType[v as 'SINGLE'] ?? v;
  if ((key === 'role' || key === 'previousRole') && typeof v === 'string') return t.roles[v as 'MANAGER'] ?? v;
  if (key === 'clientActionAt' && typeof v === 'string') return formatDateTime(v);
  if (Array.isArray(v)) return String(v.length);
  if (v && typeof v === 'object' && 'from' in v && 'to' in v) {
    const o = v as { from: unknown; to: unknown };
    return `${String(o.from)} ← ${String(o.to)}`;
  }
  return String(v);
}

function summarizeUa(ua: string): string {
  const os = /Android/.test(ua) ? 'Android' : /iPhone|iPad/.test(ua) ? 'iOS' : /Windows/.test(ua) ? 'Windows' : /Mac OS/.test(ua) ? 'macOS' : 'Linux';
  const browser = /Edg\//.test(ua) ? 'Edge' : /Chrome\//.test(ua) ? 'Chrome' : /Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : '';
  return [os, browser].filter(Boolean).join(' · ');
}
