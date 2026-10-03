import { Role } from '@prisma/client';
import { randomUUID } from 'crypto';
import { Client, createHarness, Harness, testImage } from './helpers/harness';

describe('Request lifecycle (e2e)', () => {
  let h: Harness;
  let manager: Client;
  let workers: Array<{ id: string; client: Client }>;

  beforeAll(async () => {
    h = await createHarness();
  });
  afterAll(async () => {
    await h.close();
  });
  beforeEach(async () => {
    await h.reset();
    await h.createUser(Role.MANAGER, '2000', 'محمد');
    manager = await h.login('2000');
    workers = [];
    for (const [pin, name] of [
      ['3001', 'أحمد'],
      ['3002', 'محمد العامل'],
      ['3003', 'محمود'],
    ]) {
      const w = await h.createUser(Role.WORKER, pin, name);
      workers.push({ id: w.id, client: await h.login(pin) });
    }
  });

  async function upload(client: Client, buffer?: Buffer, name = 'photo.jpg') {
    const res = await client.upload('/api/attachments', buffer ?? (await testImage()), name, { clientUploadId: randomUUID() });
    return res;
  }

  async function send(body: Partial<{ title: string; targetType: string; workerIds: string[]; attachmentIds: string[]; idempotencyKey: string }>) {
    return manager.post('/api/requests', { idempotencyKey: randomUUID(), title: 'إحضار المستندات', targetType: 'SINGLE', ...body });
  }

  describe('sending', () => {
    it('to one worker, without an image', async () => {
      const res = await send({ workerIds: [workers[0].id] });
      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({ title: 'إحضار المستندات', status: 'ACTIVE', targetType: 'SINGLE', attachments: [] });
      expect(res.body.recipients).toHaveLength(1);
      expect(res.body.recipients[0]).toMatchObject({ workerId: workers[0].id, workerName: 'أحمد', status: 'NEW' });
      expect(res.body.createdBy.name).toBe('محمد');
    });

    it('to several workers — one independent recipient each', async () => {
      const res = await send({ targetType: 'MULTIPLE', workerIds: [workers[0].id, workers[2].id] });
      expect(res.status).toBe(201);
      expect(res.body.recipients.map((r: { workerId: string }) => r.workerId).sort()).toEqual([workers[0].id, workers[2].id].sort());
    });

    it('to all active workers (disabled workers excluded)', async () => {
      await h.prisma.user.update({ where: { id: workers[1].id }, data: { isActive: false } });
      const res = await send({ targetType: 'ALL' });
      expect(res.status).toBe(201);
      expect(res.body.recipients).toHaveLength(2);
      expect(res.body.recipients.find((r: { workerId: string }) => r.workerId === workers[1].id)).toBeUndefined();
    });

    it('rejects SINGLE with two workers and unknown / disabled workers', async () => {
      expect((await send({ workerIds: [workers[0].id, workers[1].id] })).body.code).toBe('INVALID_RECIPIENTS');
      expect((await send({ workerIds: [randomUUID()] })).body.code).toBe('INVALID_RECIPIENTS');
      await h.prisma.user.update({ where: { id: workers[0].id }, data: { isActive: false } });
      expect((await send({ workerIds: [workers[0].id] })).body.code).toBe('INVALID_RECIPIENTS');
    });

    it('requires a title', async () => {
      const res = await send({ title: ' ', workerIds: [workers[0].id] });
      expect(res.status).toBe(400);
      expect(res.body.code).toBe('VALIDATION_FAILED');
    });

    it('with one image: compressed to WebP and resized', async () => {
      const up = await upload(manager, await testImage(4000, 3000, 'png'), 'big.png');
      expect(up.status).toBe(201);
      expect(up.body).toMatchObject({ mimeType: 'image/webp', width: 1600, height: 1200 });
      const res = await send({ workerIds: [workers[0].id], attachmentIds: [up.body.id] });
      expect(res.status).toBe(201);
      expect(res.body.attachments).toHaveLength(1);
      const row = await h.prisma.requestAttachment.findUniqueOrThrow({ where: { id: up.body.id } });
      expect(row.sizeBytes).toBeLessThan(200_000);
    });

    it('with three images, in order', async () => {
      const ids = [];
      for (let i = 0; i < 3; i++) ids.push((await upload(manager)).body.id);
      const res = await send({ workerIds: [workers[0].id], attachmentIds: ids });
      expect(res.status).toBe(201);
      expect(res.body.attachments.map((a: { id: string }) => a.id)).toEqual(ids);
    });

    it('rejects a fourth image', async () => {
      const ids = [];
      for (let i = 0; i < 4; i++) ids.push((await upload(manager)).body.id);
      const res = await send({ workerIds: [workers[0].id], attachmentIds: ids });
      expect(res.status).toBe(400);
    });

    it('rejects non-image files even when renamed', async () => {
      const pdf = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF');
      const asPdf = await manager.upload('/api/attachments', pdf, 'doc.pdf', { clientUploadId: randomUUID() });
      expect(asPdf.status).toBe(400);
      expect(asPdf.body.code).toBe('INVALID_IMAGE');
      const disguised = await manager.upload('/api/attachments', pdf, 'photo.jpg', { clientUploadId: randomUUID() });
      expect(disguised.status).toBe(400);
      expect(disguised.body.code).toBe('INVALID_IMAGE');
    });

    it('upload retry with the same clientUploadId does not duplicate', async () => {
      const id = randomUUID();
      const img = await testImage();
      const a = await manager.upload('/api/attachments', img, 'a.jpg', { clientUploadId: id });
      const b = await manager.upload('/api/attachments', img, 'a.jpg', { clientUploadId: id });
      expect(a.body.id).toBe(b.body.id);
      expect(await h.prisma.requestAttachment.count()).toBe(1);
    });

    it('another manager cannot attach my uploads', async () => {
      await h.createUser(Role.MANAGER, '2001');
      const other = await h.login('2001');
      const up = await upload(manager);
      const res = await other.post('/api/requests', {
        idempotencyKey: randomUUID(),
        title: 'x y',
        targetType: 'ALL',
        attachmentIds: [up.body.id],
      });
      expect(res.body.code).toBe('ATTACHMENT_NOT_AVAILABLE');
    });
  });

  describe('duplicate prevention (idempotency)', () => {
    it('double click / retry with the same key creates exactly one request', async () => {
      const key = randomUUID();
      const body = { idempotencyKey: key, title: 'طلب', targetType: 'SINGLE', workerIds: [workers[0].id] };
      const results = await Promise.all([manager.post('/api/requests', body), manager.post('/api/requests', body), manager.post('/api/requests', body)]);
      expect(new Set(results.map((r) => r.body.id)).size).toBe(1);
      expect(results.every((r) => r.status === 201)).toBe(true);
      expect(await h.prisma.request.count()).toBe(1);
      expect(await h.prisma.requestRecipient.count()).toBe(1);
    });

    it('a different payload with a reused key is rejected', async () => {
      const key = randomUUID();
      await send({ idempotencyKey: key, workerIds: [workers[0].id] });
      const res = await send({ idempotencyKey: key, title: 'عنوان آخر', workerIds: [workers[0].id] });
      expect(res.status).toBe(409);
      expect(res.body.code).toBe('IDEMPOTENCY_CONFLICT');
    });
  });

  describe('worker flow: open → acknowledge → complete', () => {
    it('records server timestamps for every step and enforces the order', async () => {
      const req = (await send({ workerIds: [workers[0].id] })).body;
      const recipientId = req.recipients[0].id;
      const w = workers[0].client;

      const list = await w.get('/api/worker/requests');
      expect(list.body.items).toHaveLength(1);
      expect(list.body.items[0]).toMatchObject({ recipientId, title: 'إحضار المستندات', managerName: 'محمد', status: 'NEW' });

      const early = await w.post(`/api/worker/requests/${recipientId}/complete`);
      expect(early.status).toBe(409);
      expect(early.body.code).toBe('MUST_ACKNOWLEDGE_FIRST');

      const opened = await w.post(`/api/worker/requests/${recipientId}/open`);
      expect(opened.body.openedAt).toBeTruthy();

      const ack = await w.post(`/api/worker/requests/${recipientId}/acknowledge`, { clientActionAt: '2000-01-01T00:00:00Z' });
      expect(ack.status).toBe(200);
      expect(ack.body.applied).toBe(true);
      expect(ack.body.item.status).toBe('ACKNOWLEDGED');
      // Server time is authoritative, never the device clock.
      expect(new Date(ack.body.item.acknowledgedAt).getFullYear()).toBeGreaterThan(2020);

      const done = await w.post(`/api/worker/requests/${recipientId}/complete`);
      expect(done.body.item.status).toBe('COMPLETED');

      const detail = (await manager.get(`/api/requests/${req.id}`)).body;
      const rc = detail.recipients[0];
      expect(rc.status).toBe('COMPLETED');
      for (const k of ['openedAt', 'acknowledgedAt', 'completedAt']) expect(rc[k]).toMatch(/\.\d{3}Z$/);
      expect(new Date(rc.completedAt) >= new Date(rc.acknowledgedAt)).toBe(true);

      const actions = (await h.prisma.auditLog.findMany()).map((a) => a.action);
      expect(actions).toEqual(expect.arrayContaining(['REQUEST_CREATED', 'REQUEST_OPENED', 'REQUEST_ACKNOWLEDGED', 'REQUEST_COMPLETED']));
    });

    it('each worker has an independent status', async () => {
      const req = (await send({ targetType: 'ALL' })).body;
      const byWorker = (id: string) => req.recipients.find((r: { workerId: string }) => r.workerId === id).id;
      await workers[0].client.post(`/api/worker/requests/${byWorker(workers[0].id)}/acknowledge`);
      await workers[0].client.post(`/api/worker/requests/${byWorker(workers[0].id)}/complete`);
      await workers[1].client.post(`/api/worker/requests/${byWorker(workers[1].id)}/acknowledge`);
      const detail = (await manager.get(`/api/requests/${req.id}`)).body;
      const status = Object.fromEntries(detail.recipients.map((r: { workerName: string; status: string }) => [r.workerName, r.status]));
      expect(status).toEqual({ أحمد: 'COMPLETED', 'محمد العامل': 'ACKNOWLEDGED', محمود: 'NEW' });
      expect(detail.counts).toEqual({ NEW: 1, ACKNOWLEDGED: 1, COMPLETED: 1, CANCELLED: 0 });
    });

    it('a worker cannot act on or see another worker’s request or images', async () => {
      const up = await upload(manager);
      const req = (await send({ workerIds: [workers[0].id], attachmentIds: [up.body.id] })).body;
      const recipientId = req.recipients[0].id;
      expect((await workers[1].client.post(`/api/worker/requests/${recipientId}/acknowledge`)).status).toBe(404);
      expect((await workers[1].client.get(`/api/attachments/${up.body.id}`)).status).toBe(404);
      const own = await workers[0].client.get(`/api/attachments/${up.body.id}`);
      expect(own.status).toBe(200);
      expect(own.headers['content-type']).toBe('image/webp');
      expect(own.headers['cache-control']).toMatch(/private/);
    });

    it('images are never available without a session', async () => {
      const up = await upload(manager);
      expect((await h.anonymous().get(`/api/attachments/${up.body.id}`)).status).toBe(401);
    });
  });

  describe('manager actions', () => {
    it('edit: updates title/images, bumps version, audit-logged', async () => {
      const req = (await send({ workerIds: [workers[0].id] })).body;
      const up = await upload(manager);
      const res = await manager.patch(`/api/requests/${req.id}`, { title: 'إحضار الملفات', attachmentIds: [up.body.id] });
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ title: 'إحضار الملفات', version: 2 });
      expect(res.body.editedAt).toBeTruthy();
      expect(res.body.attachments).toHaveLength(1);
      const item = (await workers[0].client.get('/api/worker/requests')).body.items[0];
      expect(item.title).toBe('إحضار الملفات');
      const audit = await h.prisma.auditLog.findFirst({ where: { action: 'REQUEST_UPDATED' } });
      expect(audit?.metadata).toMatchObject({ title: { from: 'إحضار المستندات', to: 'إحضار الملفات' } });
    });

    it('edit can reorder and remove images', async () => {
      const a = (await upload(manager)).body.id;
      const b = (await upload(manager)).body.id;
      const req = (await send({ workerIds: [workers[0].id], attachmentIds: [a, b] })).body;
      const res = await manager.patch(`/api/requests/${req.id}`, { attachmentIds: [b] });
      expect(res.body.attachments.map((x: { id: string }) => x.id)).toEqual([b]);
      const res2 = await manager.patch(`/api/requests/${req.id}`, { attachmentIds: [b, a] });
      expect(res2.status).toBe(200);
      expect(res2.body.attachments.map((x: { id: string }) => x.id)).toEqual([b, a]);
    });

    it('cancel: keeps the record, cancels open recipients, keeps completed ones', async () => {
      const req = (await send({ targetType: 'MULTIPLE', workerIds: [workers[0].id, workers[1].id] })).body;
      const done = req.recipients.find((r: { workerId: string }) => r.workerId === workers[0].id).id;
      await workers[0].client.post(`/api/worker/requests/${done}/acknowledge`);
      await workers[0].client.post(`/api/worker/requests/${done}/complete`);

      const res = await manager.post(`/api/requests/${req.id}/cancel`);
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('CANCELLED');
      expect(res.body.counts).toMatchObject({ COMPLETED: 1, CANCELLED: 1 });
      expect(await h.prisma.request.count()).toBe(1);
      expect((await manager.patch(`/api/requests/${req.id}`, { title: 'جديد جدا' })).body.code).toBe('REQUEST_CANCELLED');
    });

    it('resend: creates a NEW request (copying images), original untouched', async () => {
      const up = await upload(manager);
      const original = (await send({ targetType: 'MULTIPLE', workerIds: [workers[0].id, workers[1].id], attachmentIds: [up.body.id] })).body;
      await manager.post(`/api/requests/${original.id}/cancel`);

      const key = randomUUID();
      const res = await manager.post(`/api/requests/${original.id}/resend`, { idempotencyKey: key });
      expect(res.status).toBe(200);
      expect(res.body.id).not.toBe(original.id);
      expect(res.body.resentFromId).toBe(original.id);
      expect(res.body.status).toBe('ACTIVE');
      expect(res.body.recipients).toHaveLength(2);
      expect(res.body.attachments).toHaveLength(1);
      expect(res.body.attachments[0].id).not.toBe(up.body.id);

      const again = await manager.post(`/api/requests/${original.id}/resend`, { idempotencyKey: key });
      expect(again.body.id).toBe(res.body.id);
      expect(await h.prisma.request.count()).toBe(2);
      expect((await manager.get(`/api/requests/${original.id}`)).body.status).toBe('CANCELLED');
    });

    it('reopen: COMPLETED → ACKNOWLEDGED with audit; rejected for open requests', async () => {
      const req = (await send({ workerIds: [workers[0].id] })).body;
      const rid = req.recipients[0].id;
      expect((await manager.post(`/api/requests/${req.id}/reopen`)).body.code).toBe('CANNOT_REOPEN');
      await workers[0].client.post(`/api/worker/requests/${rid}/acknowledge`);
      await workers[0].client.post(`/api/worker/requests/${rid}/complete`);

      const res = await manager.post(`/api/requests/${req.id}/reopen`);
      expect(res.status).toBe(200);
      expect(res.body.recipients[0]).toMatchObject({ status: 'ACKNOWLEDGED', completedAt: null });
      expect(res.body.recipients[0].reopenedAt).toBeTruthy();
      const audit = await h.prisma.auditLog.findFirst({ where: { action: 'REQUEST_REOPENED' } });
      expect(audit).toBeTruthy();

      const done = await workers[0].client.post(`/api/worker/requests/${rid}/complete`);
      expect(done.body.item.status).toBe('COMPLETED');
    });
  });

  describe('visibility and search', () => {
    it('a manager sees only their own requests; the system admin sees all', async () => {
      await h.createUser(Role.MANAGER, '2001', 'سالم');
      await h.createUser(Role.SYSTEM_ADMIN, '1000');
      const other = await h.login('2001');
      const admin = await h.login('1000');
      const mine = (await send({ workerIds: [workers[0].id] })).body;
      await other.post('/api/requests', { idempotencyKey: randomUUID(), title: 'طلب سالم', targetType: 'ALL' });

      expect((await manager.get('/api/requests')).body.total).toBe(1);
      expect((await other.get('/api/requests')).body.total).toBe(1);
      expect((await other.get(`/api/requests/${mine.id}`)).status).toBe(404);
      expect((await other.post(`/api/requests/${mine.id}/cancel`)).status).toBe(404);
      expect((await admin.get('/api/requests')).body.total).toBe(2);
      expect((await admin.get(`/api/requests/${mine.id}`)).status).toBe(200);
    });

    it('filters by title, number, worker, status, date and supports pagination', async () => {
      const a = (await send({ title: 'إحضار المستندات', workerIds: [workers[0].id] })).body;
      await send({ title: 'تنظيف المستودع', workerIds: [workers[1].id] });
      await send({ title: 'نقل الصناديق', workerIds: [workers[1].id] });
      await workers[0].client.post(`/api/worker/requests/${a.recipients[0].id}/acknowledge`);

      const q = (s: string) => manager.get(`/api/requests?${s}`).then((r) => r.body);
      expect((await q('q=المستندات')).total).toBe(1);
      expect((await q(`q=%23${a.number}`)).items[0].id).toBe(a.id);
      expect((await q(`workerId=${workers[1].id}`)).total).toBe(2);
      expect((await q('status=ACKNOWLEDGED')).total).toBe(1);
      expect((await q('status=NEW')).total).toBe(2);
      const today = new Date().toISOString().slice(0, 10);
      expect((await q(`from=${today}&to=${today}`)).total).toBe(3);
      expect((await q('from=2000-01-01&to=2000-01-02')).total).toBe(0);
      const page = await q('pageSize=2&page=2');
      expect(page).toMatchObject({ total: 3, page: 2, pageSize: 2 });
      expect(page.items).toHaveLength(1);
      // newest first
      expect((await q('')).items[0].title).toBe('نقل الصناديق');
    });

    it('dashboard counts follow the manager scope', async () => {
      const req = (await send({ targetType: 'ALL' })).body;
      await workers[0].client.post(`/api/worker/requests/${req.recipients[0].id}/acknowledge`);
      const stats = (await manager.get('/api/dashboard/stats')).body;
      expect(stats).toMatchObject({ newRequests: 2, inProgress: 1, completedToday: 0, cancelledToday: 0, activeWorkers: 3 });
      expect(stats.onlineWorkers).toBe(3); // all three just logged in
    });
  });
});
