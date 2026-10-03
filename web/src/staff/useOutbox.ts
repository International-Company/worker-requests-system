import { useQueryClient } from '@tanstack/react-query';
import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect } from 'react';
import { db } from '../offline/db';
import { flushOutbox } from '../offline/outbox';
import { onSwMessage } from '../pwa/sw-bridge';

/** Retries queued manager requests: on start, when the network returns, and every 30 s. */
export function useOutboxFlusher(userId: string | null): void {
  const qc = useQueryClient();
  useEffect(() => {
    if (!userId) return;
    const flush = () =>
      void flushOutbox(userId).then(() => {
        void qc.invalidateQueries({ queryKey: ['requests'] });
        void qc.invalidateQueries({ queryKey: ['dashboard'] });
      });
    flush();
    window.addEventListener('online', flush);
    const interval = setInterval(flush, 30_000);
    const off = onSwMessage((m) => {
      if (m.type === 'SYNCED') flush();
    });
    return () => {
      window.removeEventListener('online', flush);
      clearInterval(interval);
      off();
    };
  }, [userId, qc]);
}

export function useOutboxEntries(userId: string | undefined) {
  return useLiveQuery(() => (userId ? db.outbox.where('userId').equals(userId).sortBy('createdAt') : []), [userId], []);
}
