import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { WorkerRequest } from '../lib/types';
import { clearUserData, db } from './db';
import { applyLocally, processQueue, pull, recordAction, syncAll } from './worker-sync';

const USER = 'worker-1';

function item(over: Partial<WorkerRequest> = {}): WorkerRequest {
  return {
    recipientId: 'r1',
    requestId: 'q1',
    number: 1,
    title: 'إحضار المستندات',
    managerName: 'محمد',
    requestStatus: 'ACTIVE',
    requestVersion: 1,
    status: 'NEW',
    stateVersion: 1,
    sentAt: '2026-10-03T10:00:00.000Z',
    editedAt: null,
    deliveredAt: null,
    openedAt: null,
    acknowledgedAt: null,
    completedAt: null,
    cancelledAt: null,
    reopenedAt: null,
    updatedAt: '2026-10-03T10:00:00.000Z',
    attachments: [],
    ...over,
  };
}

type Handler = (url: string, init: RequestInit) => { status: number; body?: unknown } | 'network';
let handler: Handler;
const calls: Array<{ url: string; body: unknown }> = [];

beforeEach(async () => {
  await clearUserData();
  calls.length = 0;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: RequestInit) => {
      calls.push({ url, body: init.body ? JSON.parse(String(init.body)) : undefined });
      const r = handler(url, init);
      if (r === 'network') throw new TypeError('Failed to fetch');
      return new Response(r.body === undefined ? null : JSON.stringify(r.body), { status: r.status });
    }),
  );
});
afterEach(() => vi.unstubAllGlobals());

describe('applyLocally (optimistic state machine)', () => {
  it('NEW → acknowledge → complete, bumping the local version each time', () => {
    const a = applyLocally(item(), 'acknowledge', 'T1')!;
    expect(a).toMatchObject({ status: 'ACKNOWLEDGED', stateVersion: 2, acknowledgedAt: 'T1', openedAt: 'T1' });
    const c = applyLocally(a, 'complete', 'T2')!;
    expect(c).toMatchObject({ status: 'COMPLETED', stateVersion: 3, completedAt: 'T2' });
  });

  it('refuses complete before acknowledge, and anything on a cancelled request', () => {
    expect(applyLocally(item(), 'complete', 'T')).toBeNull();
    expect(applyLocally(item({ status: 'CANCELLED' }), 'acknowledge', 'T')).toBeNull();
    expect(applyLocally(item({ requestStatus: 'CANCELLED' }), 'acknowledge', 'T')).toBeNull();
  });
});

describe('offline queue', () => {
  beforeEach(async () => {
    await db.requests.put({ ...item(), userId: USER });
  });

  it('records actions locally while offline and keeps them queued on network errors', async () => {
    handler = () => 'network';
    await recordAction(USER, 'r1', 'acknowledge');
    await recordAction(USER, 'r1', 'complete');
    expect((await db.requests.get('r1'))?.status).toBe('COMPLETED');

    const res = await processQueue(USER);
    expect(res).toMatchObject({ sent: 0, offline: true, remaining: 2 });
    expect(await db.queue.count()).toBe(2);
  });

  it('replays in order on reconnect with chained base versions; server state is stored', async () => {
    handler = () => 'network';
    await recordAction(USER, 'r1', 'acknowledge');
    await recordAction(USER, 'r1', 'complete');

    handler = (url) => {
      if (url.endsWith('/acknowledge')) return { status: 200, body: { applied: true, item: item({ status: 'ACKNOWLEDGED', stateVersion: 2, acknowledgedAt: 'S1' }) } };
      return { status: 200, body: { applied: true, item: item({ status: 'COMPLETED', stateVersion: 3, acknowledgedAt: 'S1', completedAt: 'S2' }) } };
    };
    const res = await processQueue(USER);
    expect(res).toMatchObject({ sent: 2, remaining: 0 });
    expect(calls.map((c) => c.url)).toEqual(['/api/worker/requests/r1/acknowledge', '/api/worker/requests/r1/complete']);
    expect((calls[0].body as { baseStateVersion: number }).baseStateVersion).toBe(1);
    expect((calls[1].body as { baseStateVersion: number }).baseStateVersion).toBe(2);
    // Server timestamps replace the local ones.
    expect(await db.requests.get('r1')).toMatchObject({ status: 'COMPLETED', completedAt: 'S2' });
  });

  it('conflict: manager cancelled meanwhile → action dropped, server state adopted, notice shown', async () => {
    handler = () => 'network';
    await recordAction(USER, 'r1', 'acknowledge');
    handler = () => ({
      status: 409,
      body: { code: 'REQUEST_CANCELLED', message: 'تم إلغاء هذا الطلب', details: { item: item({ status: 'CANCELLED', requestStatus: 'CANCELLED' }) } },
    });
    const res = await processQueue(USER);
    expect(res).toMatchObject({ dropped: 1, remaining: 0 });
    expect((await db.requests.get('r1'))?.status).toBe('CANCELLED');
    const notices = await db.notices.toArray();
    expect(notices).toHaveLength(1);
    expect(notices[0]).toMatchObject({ kind: 'conflict-cancelled', title: 'إحضار المستندات' });
  });

  it('stops on 5xx (keeps order) and on 401 (session ended) without dropping anything', async () => {
    await recordAction(USER, 'r1', 'acknowledge');
    handler = () => ({ status: 503, body: { code: 'HTTP_503', message: 'x' } });
    expect(await processQueue(USER)).toMatchObject({ remaining: 1 });
    handler = () => ({ status: 401, body: { code: 'SESSION_EXPIRED', message: 'x' } });
    expect(await processQueue(USER)).toMatchObject({ authFailed: true, remaining: 1 });
  });

  it('double tap records a single action', async () => {
    handler = () => 'network';
    await recordAction(USER, 'r1', 'acknowledge');
    await recordAction(USER, 'r1', 'acknowledge');
    expect(await db.queue.count()).toBe(1);
  });
});

describe('pull', () => {
  it('stores items, remembers serverTime and uses ?since= next time; keeps local pending overlay', async () => {
    handler = () => ({ status: 200, body: { items: [item()], serverTime: '2026-10-03T10:05:00.000Z', full: true } });
    const first = await pull(USER);
    expect(first.newItems).toHaveLength(1);

    handler = () => 'network';
    await recordAction(USER, 'r1', 'acknowledge'); // pending locally

    handler = () => ({ status: 200, body: { items: [item({ title: 'معدل' })], serverTime: '2026-10-03T10:06:00.000Z', full: false } });
    const second = await pull(USER);
    expect(calls.at(-1)!.url).toContain('since=2026-10-03T10%3A05%3A00.000Z');
    expect(second.newItems).toHaveLength(0);
    // Edited title from the server + still-pending local acknowledge.
    expect(await db.requests.get('r1')).toMatchObject({ title: 'معدل', status: 'ACKNOWLEDGED' });
  });

  it('syncAll reports offline without throwing', async () => {
    handler = () => 'network';
    await expect(syncAll(USER)).resolves.toMatchObject({ offline: true });
  });
});
