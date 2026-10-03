import { CheckCircle2, Info, TriangleAlert } from 'lucide-react';
import { createContext, type ReactNode, useCallback, useContext, useMemo, useState } from 'react';
import { cx } from './ui';

type Kind = 'success' | 'error' | 'info';
interface ToastItem {
  id: number;
  kind: Kind;
  message: string;
}

const ToastContext = createContext<(kind: Kind, message: string) => void>(() => undefined);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const push = useCallback((kind: Kind, message: string) => {
    const id = Date.now() + Math.random();
    setItems((prev) => [...prev.slice(-2), { id, kind, message }]);
    setTimeout(() => setItems((prev) => prev.filter((x) => x.id !== id)), kind === 'error' ? 7000 : 4000);
  }, []);
  return (
    <ToastContext.Provider value={push}>
      {children}
      <div className="pointer-events-none fixed inset-x-0 bottom-20 z-[60] flex flex-col items-center gap-2 px-3 md:bottom-6" aria-live="polite">
        {items.map((item) => {
          const Icon = item.kind === 'success' ? CheckCircle2 : item.kind === 'error' ? TriangleAlert : Info;
          return (
            <div
              key={item.id}
              role={item.kind === 'error' ? 'alert' : 'status'}
              className={cx(
                'pointer-events-auto flex w-full max-w-md items-start gap-2 rounded-lg px-4 py-3 text-[15px] shadow-lg',
                item.kind === 'success' && 'bg-emerald-700 text-white',
                item.kind === 'error' && 'bg-red-700 text-white',
                item.kind === 'info' && 'bg-ink text-white',
              )}
            >
              <Icon className="mt-0.5 size-5 shrink-0" aria-hidden />
              <span>{item.message}</span>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const push = useContext(ToastContext);
  return useMemo(
    () => ({
      success: (m: string) => push('success', m),
      error: (m: string) => push('error', m),
      info: (m: string) => push('info', m),
    }),
    [push],
  );
}
