import { Role } from '@prisma/client';
import { randomUUID } from 'crypto';
import { createHarness, Harness } from './helpers/harness';

describe('Authentication & authorization (e2e)', () => {
  let h: Harness;

  beforeAll(async () => {
    h = await createHarness();
  });
  afterAll(async () => {
    await h.close();
  });
  beforeEach(async () => {
    await h.reset();
  });

  describe('PIN login', () => {
    it('logs in with a correct PIN, sets an httpOnly session cookie and never returns the PIN', async () => {
      await h.createUser(Role.MANAGER, '2000', 'محمد');
      const res = await h
        .anonymous()
        .post('/api/auth/login', { pin: '2000', deviceKey: randomUUID() });
      expect(res.status).toBe(200);
      expect(res.body.user).toEqual({ id: expect.any(String), name: 'محمد', role: 'MANAGER' });
      const cookie = String(res.headers['set-cookie']);
      expect(cookie).toMatch(/wr_session=/);
      expect(cookie).toMatch(/HttpOnly/i);
      expect(cookie).toMatch(/SameSite=Strict/i);
      expect(JSON.stringify(res.body)).not.toContain('2000');
      expect(JSON.stringify(res.body)).not.toMatch(/pin/i);
    });

    it('rejects a wrong PIN with an Arabic message and no stack trace', async () => {
      await h.createUser(Role.MANAGER, '2000');
      const res = await h.anonymous().post('/api/auth/login', { pin: '9999', deviceKey: randomUUID() });
      expect(res.status).toBe(401);
      expect(res.body).toEqual({ statusCode: 401, code: 'INVALID_PIN', message: 'رمز الدخول غير صحيح' });
    });

    it('rejects malformed PINs (validation)', async () => {
      const res = await h.anonymous().post('/api/auth/login', { pin: '12a4', deviceKey: randomUUID() });
      expect(res.status).toBe(400);
      expect(res.body.code).toBe('VALIDATION_FAILED');
    });

    it('blocks disabled accounts', async () => {
      const w = await h.createUser(Role.WORKER, '3001');
      await h.prisma.user.update({ where: { id: w.id }, data: { isActive: false } });
      const res = await h.anonymous().post('/api/auth/login', { pin: '3001', deviceKey: randomUUID() });
      expect(res.status).toBe(403);
      expect(res.body.code).toBe('ACCOUNT_DISABLED');
    });

    it('writes a login log with role and device, without the PIN', async () => {
      const m = await h.createUser(Role.MANAGER, '2000');
      const deviceKey = randomUUID();
      await h.login('2000', deviceKey);
      const logs = await h.prisma.loginLog.findMany();
      expect(logs).toHaveLength(1);
      expect(logs[0]).toMatchObject({ userId: m.id, role: 'MANAGER', deviceKey });
      expect(JSON.stringify(logs)).not.toContain('"2000"');
    });

    it('stores only an HMAC of the PIN', async () => {
      const m = await h.createUser(Role.MANAGER, '2000');
      const row = await h.prisma.user.findUniqueOrThrow({ where: { id: m.id } });
      expect(row.pinHash).toMatch(/^[0-9a-f]{64}$/);
      expect(row.pinHash).not.toContain('2000');
    });

    it('rate-limits login attempts per IP (brute-force protection, no account lock)', async () => {
      process.env.THROTTLE_DISABLED = 'false';
      try {
        const c = h.anonymous();
        const statuses: number[] = [];
        for (let i = 0; i < 11; i++) {
          statuses.push((await c.post('/api/auth/login', { pin: '9999', deviceKey: randomUUID() })).status);
        }
        expect(statuses.slice(0, 10).every((s) => s === 401)).toBe(true);
        expect(statuses[10]).toBe(429);
      } finally {
        process.env.THROTTLE_DISABLED = 'true';
      }
    });
  });

  describe('sessions', () => {
    it('requires authentication', async () => {
      const res = await h.anonymous().get('/api/auth/me');
      expect(res.status).toBe(401);
      expect(res.body.code).toBe('UNAUTHENTICATED');
    });

    it('rejects state-changing requests without the CSRF header', async () => {
      await h.createUser(Role.MANAGER, '2000');
      const c = await h.login('2000');
      const res = await c.agent.post('/api/auth/logout').send({});
      expect(res.status).toBe(403);
    });

    it('rejects cross-site Origin headers', async () => {
      await h.createUser(Role.MANAGER, '2000');
      const c = await h.login('2000');
      const res = await c.agent
        .post('/api/auth/logout')
        .set('X-Requested-With', 'XMLHttpRequest')
        .set('Origin', 'https://evil.example')
        .send({});
      expect(res.status).toBe(403);
    });

    it('logout invalidates the session', async () => {
      await h.createUser(Role.MANAGER, '2000');
      const c = await h.login('2000');
      expect((await c.get('/api/auth/me')).status).toBe(200);
      expect((await c.post('/api/auth/logout')).status).toBe(204);
      expect((await c.get('/api/auth/me')).status).toBe(401);
    });

    it('disabling a user ends their existing session immediately', async () => {
      const w = await h.createUser(Role.WORKER, '3001');
      const c = await h.login('3001');
      await h.prisma.user.update({ where: { id: w.id }, data: { isActive: false } });
      const res = await c.get('/api/worker/requests');
      expect(res.status).toBe(403);
      expect(res.body.code).toBe('ACCOUNT_DISABLED');
    });
  });

  describe('device binding (one active device per worker)', () => {
    it('logging in from a new browser disconnects the previous one', async () => {
      const w = await h.createUser(Role.WORKER, '3001');
      const phoneA = await h.login('3001', randomUUID());
      const phoneB = await h.login('3001', randomUUID());

      expect((await phoneB.get('/api/worker/requests')).status).toBe(200);
      const old = await phoneA.get('/api/worker/requests');
      expect(old.status).toBe(401);
      expect(['DEVICE_REVOKED', 'SESSION_EXPIRED']).toContain(old.body.code);

      const devices = await h.prisma.device.findMany({ where: { userId: w.id } });
      expect(devices.filter((d) => d.isActive)).toHaveLength(1);
      expect(devices.find((d) => !d.isActive)?.revokedReason).toBe('REPLACED');
    });

    it('a shared browser used by another worker is unbound from the first worker', async () => {
      await h.createUser(Role.WORKER, '3001');
      const w2 = await h.createUser(Role.WORKER, '3002');
      const shared = randomUUID();
      await h.login('3001', shared);
      await h.login('3002', shared);
      const active = await h.prisma.device.findMany({ where: { deviceKey: shared, isActive: true } });
      expect(active).toHaveLength(1);
      expect(active[0].userId).toBe(w2.id);
    });

    it('staff may stay signed in on several browsers', async () => {
      await h.createUser(Role.MANAGER, '2000');
      const desk = await h.login('2000');
      const phone = await h.login('2000');
      expect((await desk.get('/api/auth/me')).status).toBe(200);
      expect((await phone.get('/api/auth/me')).status).toBe(200);
    });
  });

  describe('role-based authorization', () => {
    let admin: Awaited<ReturnType<Harness['login']>>;
    let manager: Awaited<ReturnType<Harness['login']>>;
    let worker: Awaited<ReturnType<Harness['login']>>;

    beforeEach(async () => {
      await h.createUser(Role.SYSTEM_ADMIN, '1000');
      await h.createUser(Role.MANAGER, '2000');
      await h.createUser(Role.WORKER, '3001');
      admin = await h.login('1000');
      manager = await h.login('2000');
      worker = await h.login('3001');
    });

    it.each([
      ['GET', '/api/workers', { admin: 200, manager: 200, worker: 403 }],
      ['GET', '/api/managers', { admin: 200, manager: 403, worker: 403 }],
      ['GET', '/api/settings', { admin: 200, manager: 403, worker: 403 }],
      ['GET', '/api/logs/logins', { admin: 200, manager: 403, worker: 403 }],
      ['GET', '/api/logs/audit', { admin: 200, manager: 403, worker: 403 }],
      ['GET', '/api/requests', { admin: 200, manager: 200, worker: 403 }],
      ['GET', '/api/dashboard/stats', { admin: 200, manager: 200, worker: 403 }],
      ['GET', '/api/worker/requests', { admin: 403, manager: 403, worker: 200 }],
    ] as const)('%s %s', async (_m, url, expected) => {
      expect((await admin.get(url)).status).toBe(expected.admin);
      expect((await manager.get(url)).status).toBe(expected.manager);
      expect((await worker.get(url)).status).toBe(expected.worker);
    });

    it('only managers can send requests', async () => {
      const body = { idempotencyKey: randomUUID(), title: 'x y', targetType: 'ALL' };
      expect((await admin.post('/api/requests', body)).status).toBe(403);
      expect((await worker.post('/api/requests', body)).status).toBe(403);
      expect((await manager.post('/api/requests', body)).status).toBe(201);
    });
  });
});
