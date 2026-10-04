import { useLiveQuery } from 'dexie-react-hooks';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { ApiError, post } from '../lib/api';
import { db, getMeta } from '../offline/db';
import { syncAll } from '../offline/worker-sync';
import { onSwMessage, requestBackgroundSync } from '../pwa/sw-bridge';

const DEFAULT_HEARTBEAT_S = 60;

/**
 * Keeps the worker's local data in sync:
 *  • on start, when the network returns, when the app becomes visible, on push, every minute
 *  • presence heartbeat while visible (not aggressive: default 60 s, set by the admin)
 */
export function useWorkerSync() {
  const { user, handleAuthError } = useAuth();
  const navigate = useNavigate();
  const [syncing, setSyncing] = useState(false);
  const [lastError, setLastError] = useState<'offline' | null>(null);
  const userId = user?.id;
  const busy = useRef(false);
  const again = useRef(false);
  const heartbeatSeconds = useRef(DEFAULT_HEARTBEAT_S);

  const sync = useCallback(async (): Promise<void> => {
    if (!userId) return;
    if (busy.current) {
      // A new action arrived during a running sync: run once more right after it.
      again.current = true;
      return;
    }
    busy.current = true;
    setSyncing(true);
    try {
      const res = await syncAll(userId);
      if (res.authFailed) handleAuthError(new ApiError(401, 'SESSION_EXPIRED', ''));
      setLastError(res.offline ? 'offline' : null);
      if (res.remaining > 0) void requestBackgroundSync();
    } catch (e) {
      if (!handleAuthError(e)) setLastError('offline');
    } finally {
      busy.current = false;
      setSyncing(false);
    }
    if (again.current) {
      again.current = false;
      await sync();
    }
  }, [userId, handleAuthError]);

  // Triggers
  useEffect(() => {
    if (!userId) return;
    void sync();
    const onOnline = () => void sync();
    const onVisible = () => {
      if (document.visibilityState === 'visible') void sync();
    };
    window.addEventListener('online', onOnline);
    document.addEventListener('visibilitychange', onVisible);
    // Push triggers an immediate sync; this is only the fallback while the app is open.
    const interval = setInterval(() => void sync(), 20_000);
    const off = onSwMessage((msg) => {
      if (msg.type === 'PUSH_RECEIVED' || msg.type === 'SYNCED') void sync();
      if (msg.type === 'NAVIGATE' && msg.url) navigate(msg.url);
    });
    return () => {
      window.removeEventListener('online', onOnline);
      document.removeEventListener('visibilitychange', onVisible);
      clearInterval(interval);
      off();
    };
  }, [userId, sync, navigate]);

  // Presence heartbeat
  useEffect(() => {
    if (!userId) return;
    let timer: ReturnType<typeof setTimeout>;
    const beat = async () => {
      if (document.visibilityState === 'visible' && navigator.onLine) {
        try {
          const res = await post<{ heartbeatIntervalSeconds: number }>('/presence/heartbeat', { visible: true });
          heartbeatSeconds.current = res.heartbeatIntervalSeconds || DEFAULT_HEARTBEAT_S;
        } catch (e) {
          handleAuthError(e);
        }
      }
      timer = setTimeout(beat, heartbeatSeconds.current * 1000);
    };
    void beat();
    const onVisibility = () => {
      if (document.visibilityState === 'visible') {
        clearTimeout(timer);
        void beat();
      }
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [userId, handleAuthError]);

  const pending = useLiveQuery(() => (userId ? db.queue.where('userId').equals(userId).count() : 0), [userId], 0);
  const lastSyncAt = useLiveQuery(() => (userId ? getMeta<string>(`worker.lastSyncAt:${userId}`) : undefined), [userId]);

  return { sync, syncing, pending, lastSyncAt, lastError };
}
