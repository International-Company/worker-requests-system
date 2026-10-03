import { ChildProcess, spawn } from 'child_process';
import { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { Role } from '@prisma/client';
import { createHmac, randomUUID } from 'crypto';
import { join } from 'path';
import sharp from 'sharp';
import request from 'supertest';
import type TestAgent from 'supertest/lib/agent';
import type { PushPayload, PushProvider, PushResult, PushTarget } from '../../src/push/push.types';

export const AUTH_SECRET = 'test-secret-test-secret-test-secret-0123456789';

/** Records every push instead of contacting a real push service; failures can be scripted. */
export class FakePushProvider implements PushProvider {
  readonly enabled = true;
  readonly publicKey = 'BTestVapidPublicKey';
  sent: Array<{ target: PushTarget; payload: PushPayload }> = [];
  private scripted: PushResult[] = [];

  failNext(...results: PushResult[]) {
    this.scripted.push(...results);
  }

  reset() {
    this.sent = [];
    this.scripted = [];
  }

  async send(target: PushTarget, payload: PushPayload): Promise<PushResult> {
    this.sent.push({ target, payload });
    return this.scripted.shift() ?? { ok: true };
  }
}

/** Supertest agent that keeps the session cookie and always sends the CSRF header. */
export class Client {
  constructor(readonly agent: TestAgent) {}
  get(url: string) {
    return this.agent.get(url);
  }
  post(url: string, body?: object) {
    return this.agent.post(url).set('X-Requested-With', 'XMLHttpRequest').send(body ?? {});
  }
  patch(url: string, body?: object) {
    return this.agent.patch(url).set('X-Requested-With', 'XMLHttpRequest').send(body ?? {});
  }
  put(url: string) {
    return this.agent.put(url).set('X-Requested-With', 'XMLHttpRequest');
  }
  delete(url: string, body?: object) {
    return this.agent.delete(url).set('X-Requested-With', 'XMLHttpRequest').send(body ?? {});
  }
  upload(url: string, file: Buffer, filename: string, fields: Record<string, string> = {}, method: 'post' | 'put' = 'post') {
    let req = this.agent[method](url).set('X-Requested-With', 'XMLHttpRequest');
    for (const [k, v] of Object.entries(fields)) req = req.field(k, v);
    return req.attach('file', file, filename);
  }
}

export interface Harness {
  app: NestExpressApplication;
  push: FakePushProvider;
  prisma: import('../../src/prisma/prisma.service').PrismaService;
  reset(): Promise<void>;
  /** Waits for background push dispatches to finish. */
  drain(): Promise<void>;
  close(): Promise<void>;
  createUser(role: Role, pin: string, name?: string): Promise<{ id: string; pin: string }>;
  login(pin: string, deviceKey?: string): Promise<Client>;
  anonymous(): Client;
  get<T>(token: unknown): T;
}

const TABLES = [
  'notifications',
  'push_subscriptions',
  'login_logs',
  'sessions',
  'request_attachments',
  'request_recipients',
  'requests',
  'devices',
  'presence',
  'audit_logs',
  'worker_profiles',
  'settings',
  'users',
];

export async function createHarness(): Promise<Harness> {
  const { child, port } = await startDatabase();

  Object.assign(process.env, {
    NODE_ENV: 'test',
    THROTTLE_DISABLED: 'true',
    DATABASE_URL: `postgresql://postgres:postgres@127.0.0.1:${port}/postgres?connection_limit=1&sslmode=disable`,
    AUTH_SECRET,
    APP_URL: 'http://localhost:3000',
    CORS_ORIGIN: '',
  });
  delete process.env.VAPID_PUBLIC_KEY;
  delete process.env.VAPID_PRIVATE_KEY;

  // Imported lazily so the env above is in place before config/Prisma initialise.
  const { AppModule } = await import('../../src/app.module');
  const { configureApp } = await import('../../src/app.setup');
  const { APP_CONFIG } = await import('../../src/config/app-config');
  const { PUSH_PROVIDER } = await import('../../src/push/push.types');
  const { PrismaService } = await import('../../src/prisma/prisma.service');
  const { SettingsService } = await import('../../src/settings/settings.service');
  const { NotificationsService } = await import('../../src/notifications/notifications.service');

  const push = new FakePushProvider();
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(PUSH_PROVIDER)
    .useValue(push)
    .compile();
  const app = moduleRef.createNestApplication<NestExpressApplication>({ logger: ['error'] });
  configureApp(app, app.get(APP_CONFIG));
  await app.init();
  const prisma = app.get(PrismaService);
  const http = app.getHttpServer();

  const pinHash = (pin: string) => createHmac('sha256', AUTH_SECRET).update(`pin:${pin}`).digest('hex');

  const harness: Harness = {
    app,
    push,
    prisma,
    get: <T>(token: unknown) => app.get(token as never) as T,
    async reset() {
      await app.get(NotificationsService).drain();
      await prisma.$executeRawUnsafe(`TRUNCATE ${TABLES.map((t) => `"${t}"`).join(', ')} RESTART IDENTITY CASCADE`);
      (app.get(SettingsService) as unknown as { cache: unknown }).cache = null;
      push.reset();
    },
    drain: () => app.get(NotificationsService).drain(),
    async close() {
      await app.close();
      child.kill();
    },
    async createUser(role, pin, name) {
      const user = await prisma.user.create({
        data: {
          role,
          name: name ?? `${role}-${pin}`,
          pinHash: pinHash(pin),
          ...(role === Role.WORKER ? { worker: { create: { phone: '0500000000' } } } : {}),
        },
      });
      return { id: user.id, pin };
    },
    async login(pin, deviceKey = randomUUID()) {
      const client = new Client(request.agent(http));
      const res = await client.post('/api/auth/login', { pin, deviceKey, deviceLabel: 'jest' });
      if (res.status !== 200) throw new Error(`login failed ${res.status} ${JSON.stringify(res.body)}`);
      return client;
    },
    anonymous: () => new Client(request.agent(http)),
  };
  return harness;
}

/** Runs PGlite (WASM PostgreSQL) in a child process — it cannot load inside Jest's VM sandbox. */
function startDatabase(): Promise<{ child: ChildProcess; port: number }> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [join(__dirname, 'pg-server.mjs')], { stdio: ['pipe', 'pipe', 'inherit'] });
    let out = '';
    const timer = setTimeout(() => reject(new Error('database did not start')), 60_000);
    child.stdout!.on('data', (chunk: Buffer) => {
      out += chunk.toString();
      const m = /READY (\d+)/.exec(out);
      if (m) {
        clearTimeout(timer);
        resolve({ child, port: Number(m[1]) });
      }
    });
    child.on('exit', (code) => reject(new Error(`database exited with code ${code}`)));
  });
}

/** Polls until the assertion passes (background notification dispatch is async). */
export async function eventually<T>(fn: () => Promise<T>, timeoutMs = 5000): Promise<T> {
  const start = Date.now();
  let lastError: unknown;
  while (Date.now() - start < timeoutMs) {
    try {
      return await fn();
    } catch (e) {
      lastError = e;
      await new Promise((r) => setTimeout(r, 50));
    }
  }
  throw lastError;
}

export function testImage(width = 2400, height = 1600, format: 'png' | 'jpeg' = 'jpeg'): Promise<Buffer> {
  return sharp({ create: { width, height, channels: 3, background: { r: 30, g: 90, b: 200 } } })
    [format]()
    .toBuffer();
}

/** Subscribes the logged-in worker's browser to (fake) Web Push. */
export async function subscribe(client: Client, endpoint = `https://push.example.com/${randomUUID()}`) {
  const res = await client.post('/api/push/subscribe', { endpoint, keys: { p256dh: 'p'.repeat(87), auth: 'a'.repeat(22) } });
  if (res.status !== 204) throw new Error(`subscribe failed ${res.status} ${JSON.stringify(res.body)}`);
  return endpoint;
}
