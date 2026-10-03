import { Role } from '@prisma/client';
import { randomUUID } from 'crypto';
import { Client, createHarness, Harness } from './helpers/harness';

/**
 * Simulates the worker PWA sync queue replaying actions recorded while offline.
 * Policy under test: server validates every transition; stale offline actions never
 * overwrite a newer state set by the manager; replays are idempotent.
 */
describe('Offline synchronization & conflict handling (e2e)', () => {
  let h: Harness;
  let manager: Client;
  let worker: Client;
  let workerId: string;

  beforeAll(async () => {
    h = await createHarness();
  });
  afterAll(async () => {
    await h.close();
  });
  beforeEach(async () => {
    await h.reset();
    await h.createUser(Role.MANAGER, '2000');
    workerId = (await h.createUser(Role.WORKER, '3001')).id;
    manager = await h.login('2000');
    worker = await h.login('3001');
  });

  async function newRequest() {
    const req = (
      await manager.post('/api/requests', { idempotencyKey: randomUUID(), title: 'طلب', targetType: 'SINGLE', workerIds: [workerId] })
    ).body;
    const item = (await worker.get('/api/worker/requests')).body.items.find((i: { requestId: string }) => i.requestId === req.id);
    return { req, item };
  }

  it('replays queued acknowledge + complete in order (versions chained locally)', async () => {
    const { item } = await newRequest();
    // While offline the app applied ack locally (version v → v+1) then complete on top of it.
    const ack = await worker.post(`/api/worker/requests/${item.recipientId}/acknowledge`, {
      baseStateVersion: item.stateVersion,
      clientActionAt: new Date(Date.now() - 120_000).toISOString(),
      opId: randomUUID(),
    });
    expect(ack.status).toBe(200);
    const done = await worker.post(`/api/worker/requests/${item.recipientId}/complete`, {
      baseStateVersion: item.stateVersion + 1,
      opId: randomUUID(),
    });
    expect(done.status).toBe(200);
    expect(done.body.item.status).toBe('COMPLETED');
    const audit = await h.prisma.auditLog.findFirst({ where: { action: 'REQUEST_ACKNOWLEDGED' } });
    expect(audit?.metadata).toMatchObject({ offlineReplay: true });
  });

  it('duplicate replay of the same operation is a harmless no-op', async () => {
    const { item } = await newRequest();
    const body = { baseStateVersion: item.stateVersion, opId: randomUUID() };
    const first = await worker.post(`/api/worker/requests/${item.recipientId}/acknowledge`, body);
    const second = await worker.post(`/api/worker/requests/${item.recipientId}/acknowledge`, body);
    expect(first.body.applied).toBe(true);
    expect(second.status).toBe(200);
    expect(second.body.applied).toBe(false);
    expect(await h.prisma.auditLog.count({ where: { action: 'REQUEST_ACKNOWLEDGED' } })).toBe(1);
  });

  it('concurrent duplicate submissions apply exactly once', async () => {
    const { item } = await newRequest();
    const body = { baseStateVersion: item.stateVersion };
    const results = await Promise.all(
      [1, 2, 3].map(() => worker.post(`/api/worker/requests/${item.recipientId}/acknowledge`, body)),
    );
    expect(results.map((r) => r.status)).toEqual([200, 200, 200]);
    expect(results.filter((r) => r.body.applied).length).toBe(1);
    expect(await h.prisma.auditLog.count({ where: { action: 'REQUEST_ACKNOWLEDGED' } })).toBe(1);
  });

  it('offline action on a request the manager cancelled meanwhile → 409 with fresh server state', async () => {
    const { req, item } = await newRequest();
    await manager.post(`/api/requests/${req.id}/cancel`);
    const res = await worker.post(`/api/worker/requests/${item.recipientId}/acknowledge`, { baseStateVersion: item.stateVersion });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('REQUEST_CANCELLED');
    expect(res.body.details.item.status).toBe('CANCELLED');
  });

  it('stale offline "complete" cannot overwrite a manager reopen', async () => {
    const { req, item } = await newRequest();
    await worker.post(`/api/worker/requests/${item.recipientId}/acknowledge`);
    const done = await worker.post(`/api/worker/requests/${item.recipientId}/complete`);
    const versionWhenCompleted = done.body.item.stateVersion;
    await manager.post(`/api/requests/${req.id}/reopen`);

    // An old queued "complete" based on a pre-reopen version arrives late.
    const stale = await worker.post(`/api/worker/requests/${item.recipientId}/complete`, {
      baseStateVersion: versionWhenCompleted - 1,
    });
    expect(stale.status).toBe(409);
    expect(stale.body.code).toBe('STALE_STATE');
    expect(stale.body.details.item.status).toBe('ACKNOWLEDGED');

    // With the fresh version the worker can complete again.
    const fresh = await worker.post(`/api/worker/requests/${item.recipientId}/complete`, {
      baseStateVersion: stale.body.details.item.stateVersion,
    });
    expect(fresh.body.item.status).toBe('COMPLETED');
  });

  it('incremental sync returns only changes since the last serverTime (new, edited, cancelled)', async () => {
    const a = await newRequest();
    const b = await newRequest();
    const first = (await worker.get('/api/worker/requests')).body;
    expect(first.full).toBe(true);
    expect(first.items).toHaveLength(2);

    await new Promise((r) => setTimeout(r, 6_100)); // move past the 5s overlap window
    await manager.patch(`/api/requests/${a.req.id}`, { title: 'معدل' });
    await manager.post(`/api/requests/${b.req.id}/cancel`);
    const c = await newRequest();

    const delta = (await worker.get(`/api/worker/requests?since=${encodeURIComponent(first.serverTime)}`)).body;
    expect(delta.full).toBe(false);
    const byId = Object.fromEntries(delta.items.map((i: { requestId: string }) => [i.requestId, i]));
    expect(Object.keys(byId).sort()).toEqual([a.req.id, b.req.id, c.req.id].sort());
    expect(byId[a.req.id].title).toBe('معدل');
    expect(byId[b.req.id].status).toBe('CANCELLED');
  });

  it('requests sent while the worker was offline are delivered on next sync', async () => {
    await worker.post('/api/auth/logout'); // phone switched off / logged out
    await newRequest().catch(() => undefined);
    const req = (
      await manager.post('/api/requests', { idempotencyKey: randomUUID(), title: 'أثناء الانقطاع', targetType: 'ALL' })
    ).body;
    const back = await h.login('3001');
    const items = (await back.get('/api/worker/requests')).body.items;
    expect(items.some((i: { requestId: string }) => i.requestId === req.id)).toBe(true);
  });
});
