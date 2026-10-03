import { Role } from '@prisma/client';
import { Client, createHarness, Harness, testImage } from './helpers/harness';

describe('Workers, managers, presence & logs (e2e)', () => {
  let h: Harness;
  let admin: Client;
  let manager: Client;
  let adminId: string;

  beforeAll(async () => {
    h = await createHarness();
  });
  afterAll(async () => {
    await h.close();
  });
  beforeEach(async () => {
    await h.reset();
    adminId = (await h.createUser(Role.SYSTEM_ADMIN, '1000')).id;
    await h.createUser(Role.MANAGER, '2000');
    admin = await h.login('1000');
    manager = await h.login('2000');
  });

  describe('workers', () => {
    it('create → list (no PIN exposed) → login works', async () => {
      const res = await manager.post('/api/workers', { name: 'أحمد', phone: '0501234567', pin: '4821' });
      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({ name: 'أحمد', phone: '0501234567', isActive: true, isOnline: false, device: null });
      expect(JSON.stringify(res.body)).not.toMatch(/4821|pin/i);
      const list = (await manager.get('/api/workers')).body;
      expect(list).toHaveLength(1);
      expect(JSON.stringify(list)).not.toMatch(/pinHash/);
      await h.login('4821');
      const after = (await manager.get('/api/workers')).body[0];
      expect(after.isOnline).toBe(true);
      expect(after.device).toMatchObject({ label: 'jest', pushEnabled: false });
    });

    it('rejects a PIN already used by any account (worker or staff)', async () => {
      await manager.post('/api/workers', { name: 'أحمد', phone: '0501234567', pin: '4821' });
      expect((await manager.post('/api/workers', { name: 'سالم', phone: '0501234568', pin: '4821' })).body.code).toBe('PIN_TAKEN');
      expect((await manager.post('/api/workers', { name: 'سالم', phone: '0501234568', pin: '2000' })).body.code).toBe('PIN_TAKEN');
    });

    it('validates input with Arabic messages', async () => {
      const res = await manager.post('/api/workers', { name: 'ا', phone: 'abc', pin: '12' });
      expect(res.status).toBe(400);
      expect(res.body.message).toBe('البيانات المدخلة غير صحيحة');
      expect(JSON.stringify(res.body.details)).toMatch(/رقم الهاتف غير صحيح/);
    });

    it('update, deactivate (login blocked, excluded from ALL, history kept) and reactivate', async () => {
      const w = (await manager.post('/api/workers', { name: 'أحمد', phone: '0501234567', pin: '4821' })).body;
      const session = await h.login('4821');
      expect((await manager.patch(`/api/workers/${w.id}`, { name: 'أحمد علي' })).body.name).toBe('أحمد علي');

      expect((await manager.patch(`/api/workers/${w.id}`, { isActive: false })).body.isActive).toBe(false);
      expect((await session.get('/api/worker/requests')).status).not.toBe(200);
      expect((await h.anonymous().post('/api/auth/login', { pin: '4821', deviceKey: 'abcdefabcdefabcdef' })).body.code).toBe('ACCOUNT_DISABLED');
      expect((await manager.post('/api/requests', { idempotencyKey: 'k-12345678', title: 'x y', targetType: 'ALL' })).body.code).toBe(
        'NO_ACTIVE_RECIPIENTS',
      );
      expect((await manager.get('/api/workers')).body).toHaveLength(1); // still listed (inactive)

      await manager.patch(`/api/workers/${w.id}`, { isActive: true });
      await h.login('4821');
      const actions = (await h.prisma.auditLog.findMany({ orderBy: { createdAt: 'asc' } })).map((a) => a.action);
      expect(actions).toEqual(expect.arrayContaining(['WORKER_CREATED', 'WORKER_UPDATED', 'WORKER_DEACTIVATED', 'WORKER_ACTIVATED']));
    });

    it('change PIN: old PIN stops working, new one works, PIN not in audit log', async () => {
      const w = (await manager.post('/api/workers', { name: 'أحمد', phone: '0501234567', pin: '4821' })).body;
      expect((await manager.post(`/api/workers/${w.id}/change-pin`, { pin: '5555' })).status).toBe(204);
      expect((await h.anonymous().post('/api/auth/login', { pin: '4821', deviceKey: 'abcdefabcdefabcdef' })).status).toBe(401);
      await h.login('5555');
      const audit = await h.prisma.auditLog.findFirstOrThrow({ where: { action: 'WORKER_PIN_CHANGED' } });
      expect(JSON.stringify(audit)).not.toContain('5555');
    });

    it('photo upload is compressed and only served to authenticated users', async () => {
      const w = (await manager.post('/api/workers', { name: 'أحمد', phone: '0501234567', pin: '4821' })).body;
      const up = await manager.upload(`/api/workers/${w.id}/photo`, await testImage(1200, 1200), 'me.jpg', {}, 'put');
      expect(up.status).toBe(200);
      expect(up.body.photoVersion).toBeTruthy();
      const img = await manager.get(`/api/workers/${w.id}/photo`);
      expect(img.headers['content-type']).toBe('image/webp');
      expect((await h.anonymous().get(`/api/workers/${w.id}/photo`)).status).toBe(401);
    });

    it('system admin soft-deletes a worker: hidden, PIN released, requests preserved', async () => {
      const w = (await manager.post('/api/workers', { name: 'أحمد', phone: '0501234567', pin: '4821' })).body;
      await manager.post('/api/requests', { idempotencyKey: 'k-12345678', title: 'x y', targetType: 'SINGLE', workerIds: [w.id] });
      expect((await manager.delete(`/api/workers/${w.id}`)).status).toBe(403);
      expect((await admin.delete(`/api/workers/${w.id}`)).status).toBe(204);
      expect((await admin.get('/api/workers')).body).toHaveLength(0);
      expect(await h.prisma.requestRecipient.count({ where: { workerId: w.id } })).toBe(1);
      expect((await manager.post('/api/workers', { name: 'جديد', phone: '0501234567', pin: '4821' })).status).toBe(201);
    });
  });

  describe('managers (system admin only)', () => {
    it('create, update, change PIN, deactivate, disconnect', async () => {
      const m = (await admin.post('/api/managers', { name: 'سالم', pin: '7310' })).body;
      expect(m).toMatchObject({ name: 'سالم', role: 'MANAGER', isActive: true });
      const s = await h.login('7310');
      expect((await admin.patch(`/api/managers/${m.id}`, { name: 'سالم أحمد' })).body.name).toBe('سالم أحمد');
      expect((await admin.post(`/api/managers/${m.id}/disconnect-device`)).status).toBe(204);
      expect((await s.get('/api/auth/me')).status).toBe(401);
      expect((await admin.post(`/api/managers/${m.id}/change-pin`, { pin: '7311' })).status).toBe(204);
      await h.login('7311');
      expect((await admin.patch(`/api/managers/${m.id}`, { isActive: false })).body.isActive).toBe(false);
      expect((await h.anonymous().post('/api/auth/login', { pin: '7311', deviceKey: 'abcdefabcdefabcdef' })).body.code).toBe('ACCOUNT_DISABLED');
      const list = (await admin.get('/api/managers')).body;
      expect(list.find((x: { id: string }) => x.id === m.id).lastLoginAt).toBeTruthy();
    });

    it('a disabled manager can no longer send requests', async () => {
      const m = (await admin.post('/api/managers', { name: 'سالم', pin: '7310' })).body;
      const s = await h.login('7310');
      await admin.patch(`/api/managers/${m.id}`, { isActive: false });
      expect((await s.post('/api/requests', { idempotencyKey: 'k-12345678', title: 'x y', targetType: 'ALL' })).status).toBe(401);
    });

    it('protects the admin against locking themselves / the system out', async () => {
      expect((await admin.patch(`/api/managers/${adminId}`, { isActive: false })).body.code).toBe('CANNOT_MODIFY_SELF');
      expect((await admin.delete(`/api/managers/${adminId}`)).body.code).toBe('CANNOT_MODIFY_SELF');
      const other = (await admin.post('/api/managers', { name: 'مدير2', pin: '1001', role: 'SYSTEM_ADMIN' })).body;
      const otherSession = await h.login('1001');
      expect((await otherSession.patch(`/api/managers/${adminId}`, { isActive: false })).status).toBe(200);
      expect((await otherSession.patch(`/api/managers/${other.id}`, { role: 'MANAGER' })).body.code).toBe('CANNOT_MODIFY_SELF');
    });

    it('roles catalogue is available to the admin', async () => {
      const roles = (await admin.get('/api/roles')).body;
      expect(roles.map((r: { role: string }) => r.role)).toEqual(['SYSTEM_ADMIN', 'MANAGER', 'WORKER']);
    });
  });

  describe('presence & logs', () => {
    it('heartbeat marks the worker online; stale heartbeat shows offline with last seen', async () => {
      const w = await h.createUser(Role.WORKER, '3001');
      const ws = await h.login('3001');
      const hb = await ws.post('/api/presence/heartbeat', { visible: true });
      expect(hb.body).toMatchObject({ heartbeatIntervalSeconds: 60 });
      expect((await manager.get(`/api/workers/${w.id}`)).body.isOnline).toBe(true);
      await h.prisma.presence.update({ where: { userId: w.id }, data: { lastSeenAt: new Date(Date.now() - 10 * 60_000) } });
      const view = (await manager.get(`/api/workers/${w.id}`)).body;
      expect(view.isOnline).toBe(false);
      expect(view.lastSeenAt).toBeTruthy();
    });

    it('login log shows user, role, device and last activity', async () => {
      const logs = (await admin.get('/api/logs/logins')).body;
      expect(logs.total).toBe(2);
      expect(logs.items[0]).toMatchObject({ role: expect.any(String), deviceKey: expect.any(String) });
      expect(logs.items[0].session.lastUsedAt).toBeTruthy();
    });

    it('audit log cannot be deleted, even directly in the database', async () => {
      await manager.post('/api/workers', { name: 'أحمد', phone: '0501234567', pin: '4821' });
      await expect(h.prisma.auditLog.deleteMany()).rejects.toThrow(/append-only/);
      expect((await admin.get('/api/logs/audit')).body.total).toBeGreaterThan(0);
    });
  });
});
