import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ShieldCheck } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useToast } from '../components/Toast';
import { Button, Card, ErrorBox, Field, Input, PageHeader, Spinner } from '../components/ui';
import { t } from '../i18n';
import { errorMessage, get, patch } from '../lib/api';
import type { SettingItem } from '../lib/types';

/** Only the settings the backend whitelists are editable; values are validated server-side. */
export function SettingsPage() {
  const toast = useToast();
  const qc = useQueryClient();
  const settings = useQuery({ queryKey: ['settings'], queryFn: () => get<SettingItem[]>('/settings') });
  const roles = useQuery({ queryKey: ['roles'], queryFn: () => get<Array<{ role: string; label: string; permissions: string[] }>>('/roles') });
  const [values, setValues] = useState<Record<string, string | boolean>>({});

  useEffect(() => {
    if (settings.data) setValues(Object.fromEntries(settings.data.map((s) => [s.key, typeof s.value === 'boolean' ? s.value : String(s.value)])));
  }, [settings.data]);

  const groups = useMemo(() => {
    const map = new Map<string, SettingItem[]>();
    for (const s of settings.data ?? []) map.set(s.group, [...(map.get(s.group) ?? []), s]);
    return [...map.entries()];
  }, [settings.data]);

  const save = useMutation({
    mutationFn: () => {
      const changed: Record<string, unknown> = {};
      for (const s of settings.data ?? []) {
        const v = values[s.key];
        const typed = s.type === 'number' ? Number(v) : s.type === 'boolean' ? Boolean(v) : String(v).trim();
        if (typed !== s.value) changed[s.key] = typed;
      }
      return patch<SettingItem[]>('/settings', { values: changed });
    },
    onSuccess: (data) => {
      qc.setQueryData(['settings'], data);
      toast.success(t.common.saved);
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  if (settings.isLoading) return <Spinner />;
  if (settings.isError) return <ErrorBox message={errorMessage(settings.error)} onRetry={() => void settings.refetch()} />;

  return (
    <div className="max-w-3xl">
      <PageHeader title={t.settings.title} />
      <form
        className="space-y-5"
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate();
        }}
      >
        {groups.map(([group, items]) => (
          <Card key={group} className="space-y-4 p-5">
            <h2 className="font-bold">{t.settings.groups[group] ?? group}</h2>
            {items.map((s) =>
              s.type === 'boolean' ? (
                <label key={s.key} className="flex items-center gap-3">
                  <input
                    type="checkbox"
                    checked={Boolean(values[s.key])}
                    onChange={(e) => setValues((v) => ({ ...v, [s.key]: e.target.checked }))}
                    className="size-5 accent-brand-600"
                  />
                  {s.label}
                </label>
              ) : (
                <Field key={s.key} label={s.label} hint={s.type === 'number' ? `${s.min} – ${s.max}${s.unit ? ` ${s.unit}` : ''}` : undefined}>
                  {(id) => (
                    <Input
                      id={id}
                      type={s.type === 'number' ? 'number' : 'text'}
                      min={s.min}
                      max={s.max}
                      maxLength={s.maxLength}
                      value={String(values[s.key] ?? '')}
                      onChange={(e) => setValues((v) => ({ ...v, [s.key]: e.target.value }))}
                      className={s.type === 'number' ? 'ltr-nums max-w-48' : undefined}
                      required
                    />
                  )}
                </Field>
              ),
            )}
          </Card>
        ))}
        <Button type="submit" size="lg" loading={save.isPending}>
          {t.common.save}
        </Button>
      </form>

      <Card className="mt-8 p-5">
        <h2 className="mb-1 flex items-center gap-2 font-bold">
          <ShieldCheck className="size-5 text-brand-600" aria-hidden />
          {t.settings.roles}
        </h2>
        <p className="mb-4 text-sm text-muted">{t.settings.rolesHint}</p>
        <div className="grid gap-4 md:grid-cols-3">
          {roles.data?.map((r) => (
            <div key={r.role} className="rounded-lg border border-line p-3">
              <p className="mb-2 font-semibold">{r.label}</p>
              <ul className="list-inside list-disc space-y-1 text-sm text-muted">
                {r.permissions.map((p) => (
                  <li key={p}>{p}</li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}
