import { t } from '../i18n';

/**
 * Thin fetch wrapper shared by the React app AND the service worker.
 * - Auth is the httpOnly session cookie (never readable by JS).
 * - Every request sends `X-Requested-With`, required by the backend CSRF guard.
 * - Errors become ApiError with the server's Arabic message.
 */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }

  /** No HTTP response at all (offline, DNS, server down). */
  get isNetwork(): boolean {
    return this.status === 0;
  }

  get isAuth(): boolean {
    return this.status === 401;
  }
}

type Body = Record<string, unknown> | unknown[] | FormData | undefined;

export async function api<T = unknown>(path: string, init: { method?: string; body?: Body; signal?: AbortSignal; keepalive?: boolean } = {}): Promise<T> {
  const headers: Record<string, string> = { 'X-Requested-With': 'XMLHttpRequest', Accept: 'application/json' };
  let body: BodyInit | undefined;
  if (init.body instanceof FormData) body = init.body;
  else if (init.body !== undefined) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(init.body);
  }

  let res: Response;
  try {
    res = await fetch(`/api${path}`, {
      method: init.method ?? (body ? 'POST' : 'GET'),
      headers,
      body,
      credentials: 'same-origin',
      cache: 'no-store',
      signal: init.signal,
      keepalive: init.keepalive,
    });
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw e;
    throw new ApiError(0, 'NETWORK', t.common.networkError);
  }

  if (res.status === 204) return undefined as T;
  const data = (await res.json().catch(() => null)) as { code?: string; message?: string; details?: unknown } | null;
  if (!res.ok) {
    const message = data?.message ?? (res.status >= 500 ? t.common.genericError : t.common.genericError);
    throw new ApiError(res.status, data?.code ?? `HTTP_${res.status}`, message, data?.details);
  }
  return data as T;
}

export const get = <T>(path: string, signal?: AbortSignal) => api<T>(path, { signal });
export const post = <T>(path: string, body: Body = {}) => api<T>(path, { method: 'POST', body });
export const patch = <T>(path: string, body: Body) => api<T>(path, { method: 'PATCH', body });
export const put = <T>(path: string, body: Body) => api<T>(path, { method: 'PUT', body });
export const del = <T>(path: string, body?: Body) => api<T>(path, { method: 'DELETE', body });

export function errorMessage(e: unknown): string {
  if (e instanceof ApiError) return e.message;
  return t.common.genericError;
}

export function qs(params: Record<string, string | number | boolean | undefined | null>): string {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== '') sp.set(k, String(v));
  const s = sp.toString();
  return s ? `?${s}` : '';
}

/** Authenticated image URL (the session cookie is sent automatically; nothing is public). */
export const attachmentUrl = (id: string, variant: 'full' | 'thumb' = 'full') => `/api/attachments/${id}?variant=${variant}`;
export const workerPhotoUrl = (id: string, version: string | null) => `/api/workers/${id}/photo?v=${version ?? ''}`;
