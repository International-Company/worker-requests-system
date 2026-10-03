import { useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';

/**
 * Dashboard live updates via Server-Sent Events (session cookie, same origin).
 * Each event just invalidates the matching queries; React Query refetches.
 * EventSource reconnects automatically after network loss.
 */
export function useLiveEvents(enabled: boolean): void {
  const qc = useQueryClient();
  useEffect(() => {
    if (!enabled || typeof EventSource === 'undefined') return;
    const es = new EventSource('/api/events/stream');
    let timer: ReturnType<typeof setTimeout> | null = null;
    const pending = new Set<string>();
    const flush = () => {
      for (const key of pending) void qc.invalidateQueries({ queryKey: [key] });
      pending.clear();
      timer = null;
    };
    // Coalesce bursts (e.g. a request sent to 30 workers) into one refetch.
    const schedule = (...keys: string[]) => {
      keys.forEach((k) => pending.add(k));
      timer ??= setTimeout(flush, 300);
    };
    const onRequest = () => schedule('requests', 'request', 'dashboard');
    const onWorker = () => schedule('workers', 'dashboard');
    for (const type of ['request.created', 'request.updated', 'request.cancelled', 'recipient.updated']) es.addEventListener(type, onRequest);
    for (const type of ['presence.updated', 'worker.updated']) es.addEventListener(type, onWorker);
    return () => {
      es.close();
      if (timer) clearTimeout(timer);
    };
  }, [enabled, qc]);
}
