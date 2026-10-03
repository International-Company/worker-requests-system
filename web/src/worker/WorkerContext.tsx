import { createContext, useContext } from 'react';
import type { useWorkerSync } from '../hooks/useWorkerSync';

export type WorkerSyncState = ReturnType<typeof useWorkerSync>;
export const WorkerSyncContext = createContext<WorkerSyncState | null>(null);

export function useWorkerSyncState(): WorkerSyncState {
  const ctx = useContext(WorkerSyncContext);
  if (!ctx) throw new Error('useWorkerSyncState outside WorkerLayout');
  return ctx;
}

/** Closes the system notification of a request (stops it ringing / sitting in the tray). */
export async function closeRequestNotification(recipientId: string): Promise<void> {
  try {
    const reg = await navigator.serviceWorker?.getRegistration();
    const list = (await reg?.getNotifications({ tag: `request-${recipientId}` })) ?? [];
    list.forEach((n) => n.close());
  } catch {
    /* not supported */
  }
}
