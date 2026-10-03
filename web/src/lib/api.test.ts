import { afterEach, describe, expect, it, vi } from 'vitest';
import { api, ApiError, qs } from './api';
import { formatDateTime, timeAgo } from './format';

afterEach(() => vi.unstubAllGlobals());

describe('api client', () => {
  it('sends the CSRF header, same-origin credentials and JSON body', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    await api('/x', { method: 'POST', body: { a: 1 } });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/api/x');
    expect(init.credentials).toBe('same-origin');
    expect((init.headers as Record<string, string>)['X-Requested-With']).toBe('XMLHttpRequest');
    expect(init.body).toBe('{"a":1}');
  });

  it('maps server errors to ApiError with the Arabic message and details', async () => {
    vi.stubGlobal('fetch', async () => new Response(JSON.stringify({ code: 'INVALID_PIN', message: 'رمز الدخول غير صحيح' }), { status: 401 }));
    const err = await api('/auth/login', { method: 'POST', body: {} }).catch((e: unknown) => e as ApiError);
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({ status: 401, code: 'INVALID_PIN', message: 'رمز الدخول غير صحيح', isAuth: true });
  });

  it('maps network failures to an offline ApiError (status 0) with an Arabic message', async () => {
    vi.stubGlobal('fetch', async () => {
      throw new TypeError('Failed to fetch');
    });
    const err = (await api('/x').catch((e: unknown) => e)) as ApiError;
    expect(err).toMatchObject({ status: 0, isNetwork: true });
    expect(err.message).toMatch(/تعذر الاتصال/);
  });

  it('builds query strings without empty values', () => {
    expect(qs({ a: 1, b: '', c: undefined, d: 'x y' })).toBe('?a=1&d=x+y');
  });
});

describe('format', () => {
  it('timestamps include seconds', () => {
    const iso = new Date(2026, 9, 3, 14, 20, 5).toISOString();
    expect(formatDateTime(iso)).toBe('2026/10/03 14:20:05');
  });

  it('relative "last seen" in Arabic', () => {
    const now = Date.parse('2026-10-03T12:00:00Z');
    expect(timeAgo('2026-10-03T11:56:00Z', now)).toBe('منذ 4 دقيقة');
    expect(timeAgo('2026-10-03T11:59:58Z', now)).toBe('الآن');
    expect(timeAgo(null, now)).toBe('لم يتصل بعد');
  });
});
