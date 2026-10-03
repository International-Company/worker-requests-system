import { useQueryClient } from '@tanstack/react-query';
import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { ApiError, get, post } from '../lib/api';
import { getDeviceKey, getDeviceLabel } from '../lib/device';
import type { Me, Role } from '../lib/types';
import { clearUserData, getMeta, setMeta, type CachedUser } from '../offline/db';
import { disablePushOnThisDevice } from '../pwa/push';
import { clearPrivateCaches } from '../pwa/sw-bridge';

interface AuthState {
  user: CachedUser | null;
  me: Me | null;
  /** True while we only know the user from the local cache (offline start). */
  offline: boolean;
  ready: boolean;
  sessionEnded: boolean;
  login(pin: string): Promise<{ deviceReplaced: boolean }>;
  logout(): Promise<void>;
  handleAuthError(e: unknown): boolean;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [user, setUser] = useState<CachedUser | null>(null);
  const [me, setMe] = useState<Me | null>(null);
  const [offline, setOffline] = useState(false);
  const [ready, setReady] = useState(false);
  const [sessionEnded, setSessionEnded] = useState(false);

  const adopt = useCallback(async (m: Me) => {
    const cached: CachedUser = { id: m.id, name: m.name, role: m.role };
    setMe(m);
    setUser(cached);
    setOffline(false);
    await setMeta('currentUser', cached);
  }, []);

  // Session check on start. Offline start → continue with the cached identity (read-only data + queue).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const m = await get<Me>('/auth/me');
        if (!cancelled) await adopt(m);
      } catch (e) {
        if (e instanceof ApiError && e.isNetwork) {
          const cached = await getMeta<CachedUser>('currentUser');
          if (!cancelled && cached) {
            setUser(cached);
            setOffline(true);
          }
        }
      } finally {
        if (!cancelled) setReady(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [adopt]);

  // Leaving offline mode: re-validate the session once the network is back.
  useEffect(() => {
    if (!offline) return;
    const retry = () =>
      get<Me>('/auth/me')
        .then(adopt)
        .catch((e) => {
          if (e instanceof ApiError && e.isAuth) {
            setUser(null);
            setSessionEnded(true);
          }
        });
    window.addEventListener('online', retry);
    return () => window.removeEventListener('online', retry);
  }, [offline, adopt]);

  const login = useCallback(
    async (pin: string) => {
      const res = await post<{ user: { id: string; name: string; role: Role }; deviceReplaced: boolean }>('/auth/login', {
        pin,
        deviceKey: getDeviceKey(),
        deviceLabel: getDeviceLabel(),
      });
      const previous = await getMeta<CachedUser>('currentUser');
      if (previous && previous.id !== res.user.id) {
        // Another account used this browser before: wipe its cached data and images.
        await clearUserData();
        await clearPrivateCaches();
      }
      queryClient.clear();
      const m = await get<Me>('/auth/me');
      await adopt(m);
      setSessionEnded(false);
      return { deviceReplaced: res.deviceReplaced };
    },
    [adopt, queryClient],
  );

  const logout = useCallback(async () => {
    await disablePushOnThisDevice().catch(() => undefined);
    await post('/auth/logout').catch(() => undefined);
    await clearUserData();
    await clearPrivateCaches();
    queryClient.clear();
    setUser(null);
    setMe(null);
  }, [queryClient]);

  /** Returns true if the error ended the session (401) — the app then shows the login page. */
  const handleAuthError = useCallback((e: unknown) => {
    if (e instanceof ApiError && e.isAuth) {
      setUser(null);
      setMe(null);
      setSessionEnded(true);
      return true;
    }
    return false;
  }, []);

  const value = useMemo<AuthState>(
    () => ({ user, me, offline, ready, sessionEnded, login, logout, handleAuthError }),
    [user, me, offline, ready, sessionEnded, login, logout, handleAuthError],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth outside AuthProvider');
  return ctx;
}
