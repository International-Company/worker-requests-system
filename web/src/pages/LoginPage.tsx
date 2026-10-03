import { Delete, Loader2, LockKeyhole } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '../auth/AuthContext';
import { useToast } from '../components/Toast';
import { cx } from '../components/ui';
import { t } from '../i18n';
import { errorMessage } from '../lib/api';

const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', 'del'] as const;

/** PIN-only login for every role. Large keypad for phones; physical keyboard works too. */
export function LoginPage() {
  const { login, sessionEnded } = useAuth();
  const toast = useToast();
  const [pin, setPin] = useState('');
  const [error, setError] = useState<string | null>(sessionEnded ? t.auth.sessionEnded : null);
  const [busy, setBusy] = useState(false);

  const submit = useCallback(
    async (value: string) => {
      setBusy(true);
      setError(null);
      try {
        const res = await login(value);
        if (res.deviceReplaced) toast.info(t.auth.deviceReplaced);
      } catch (e) {
        setError(errorMessage(e));
        setPin('');
      } finally {
        setBusy(false);
      }
    },
    [login, toast],
  );

  const press = useCallback(
    (key: string) => {
      if (busy) return;
      if (key === 'del') return setPin((p) => p.slice(0, -1));
      setPin((p) => {
        if (p.length >= 4) return p;
        const next = p + key;
        if (next.length === 4) void submit(next);
        return next;
      });
    },
    [busy, submit],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (/^\d$/.test(e.key)) press(e.key);
      else if (e.key === 'Backspace') press('del');
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [press]);

  return (
    <main className="flex min-h-full items-center justify-center bg-white px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <div className="mx-auto mb-4 flex size-14 items-center justify-center rounded-2xl bg-brand-600 text-white">
            <LockKeyhole className="size-7" aria-hidden />
          </div>
          <h1 className="text-2xl font-bold">{t.appName}</h1>
          <p className="mt-2 text-muted">{t.auth.pinHint}</p>
        </div>

        <div className="mb-3 flex justify-center gap-4" aria-label={t.auth.pinLabel} role="status" dir="ltr">
          {[0, 1, 2, 3].map((i) => (
            <span
              key={i}
              className={cx(
                'size-4 rounded-full border-2 transition-colors',
                i < pin.length ? 'border-brand-600 bg-brand-600' : 'border-brand-200 bg-white',
              )}
            />
          ))}
        </div>
        <div className="mb-4 min-h-6 text-center text-sm font-medium text-red-700" role="alert">
          {busy ? <Loader2 className="mx-auto size-5 animate-spin text-brand-600" aria-label={t.common.loading} /> : error}
        </div>

        <div className="grid grid-cols-3 gap-3" dir="ltr">
          {KEYS.map((key, i) =>
            key === '' ? (
              <span key={i} />
            ) : (
              <button
                key={i}
                type="button"
                onClick={() => press(key)}
                disabled={busy}
                aria-label={key === 'del' ? t.auth.deleteDigit : key}
                className={cx(
                  'flex h-16 items-center justify-center rounded-xl text-2xl font-semibold transition-colors disabled:opacity-50',
                  key === 'del' ? 'text-muted hover:bg-surface' : 'border border-line bg-white text-ink hover:bg-brand-50 active:bg-brand-100',
                )}
              >
                {key === 'del' ? <Delete className="size-6" /> : key}
              </button>
            ),
          )}
        </div>
      </div>
    </main>
  );
}
