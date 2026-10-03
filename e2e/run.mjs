// Full-stack browser test in a real Chrome:
//   in-memory PostgreSQL (PGlite) → migrations → dev seed → NestJS serving the built PWA
//   → manager (desktop) + worker (phone) browser profiles.
// Covers: PIN login, service worker + manifest, real Web Push subscription & delivery,
// sending a request with an image, live status updates (SSE), acknowledge/complete,
// offline action queue + reconnect sync, offline app shell, admin pages.
//
//   cd e2e && npm install && npm test        (requires: backend built, web built, Chrome installed)
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright-core';
import sharp from 'sharp';
import webpush from 'web-push';

const root = join(import.meta.dirname, '..');
const backend = join(root, 'backend');
const shots = join(import.meta.dirname, 'screenshots');
mkdirSync(shots, { recursive: true });
const PORT = 3100;
const BASE = `http://localhost:${PORT}`;
const children = [];
const results = [];
const pages = []; // screenshotted when a step fails
let failures = 0;

function start(cmd, args, opts, readyPattern) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { ...opts, stdio: ['pipe', 'pipe', 'pipe'], shell: process.platform === 'win32' && cmd === 'npx' });
    children.push(child);
    let out = '';
    const timer = setTimeout(() => reject(new Error(`timeout starting ${args.join(' ')}\n${out}`)), 90_000);
    const onData = (d) => {
      out += d.toString();
      if (process.env.E2E_VERBOSE) process.stdout.write(d);
      const m = readyPattern.exec(out);
      if (m) {
        clearTimeout(timer);
        resolve({ child, match: m, output: () => out });
      }
    };
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    child.on('exit', (code) => code && reject(new Error(`${args.join(' ')} exited ${code}\n${out}`)));
  });
}

function run(cmd, args, opts) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { ...opts, stdio: 'pipe', shell: process.platform === 'win32' });
    let out = '';
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (out += d));
    child.on('exit', (code) => (code ? reject(new Error(out)) : resolve(out)));
  });
}

async function step(name, fn, { optional = false } = {}) {
  try {
    await fn();
    results.push(`✓ ${name}`);
    console.log(`✓ ${name}`);
  } catch (e) {
    if (optional) {
      results.push(`⚠ ${name} — ${e.message.split('\n')[0]}`);
      console.log(`⚠ ${name} — ${e.message.split('\n')[0]}`);
      return;
    }
    failures++;
    for (const [i, p] of pages.entries()) {
      if (!p.isClosed()) await p.screenshot({ path: join(shots, `fail-${failures}-${i}.png`), timeout: 5000 }).catch(() => undefined);
    }
    results.push(`✗ ${name} — ${e.message.split('\n')[0]}`);
    console.error(`✗ ${name}\n  ${e.message}`);
  }
}

async function pin(page, digits) {
  // Tap the on-screen keypad like a phone user would.
  for (const d of digits) await page.getByRole('button', { name: d, exact: true }).click();
}

const cleanup = () => children.forEach((c) => c.kill());
process.on('exit', cleanup);

try {
  // ------------------------------------------------------------ stack
  const db = await start(process.execPath, [join(backend, 'test', 'helpers', 'pg-server.mjs')], { cwd: backend }, /READY (\d+)/);
  const vapid = webpush.generateVAPIDKeys();
  const env = {
    ...process.env,
    NODE_ENV: 'development',
    PORT: String(PORT),
    APP_URL: BASE,
    DATABASE_URL: `postgresql://postgres:postgres@127.0.0.1:${db.match[1]}/postgres?connection_limit=1&sslmode=disable&pgbouncer=true`,
    AUTH_SECRET: 'e2e-secret-e2e-secret-e2e-secret-0123456789',
    VAPID_PUBLIC_KEY: vapid.publicKey,
    VAPID_PRIVATE_KEY: vapid.privateKey,
    VAPID_SUBJECT: 'mailto:e2e@example.com',
    WEB_DIST_PATH: join(root, 'web', 'dist'),
    CORS_ORIGIN: '',
  };
  await run('npx', ['ts-node', '--transpile-only', 'prisma/seed.dev.ts'], { cwd: backend, env });
  await start(process.execPath, ['dist/main.js'], { cwd: backend, env }, /Listening on/);
  console.log(`stack up on ${BASE}\n`);

  const imagePath = join(shots, 'request-photo.jpg');
  writeFileSync(
    imagePath,
    await sharp({ create: { width: 2400, height: 1600, channels: 3, background: { r: 230, g: 236, b: 245 } } })
      .composite([{ input: Buffer.from('<svg width="2400" height="1600"><rect x="300" y="300" width="1800" height="1000" rx="40" fill="#1f5fbf"/><text x="1200" y="900" font-size="220" text-anchor="middle" fill="#fff">DOCS</text></svg>') }])
      .jpeg()
      .toBuffer(),
  );

  // ------------------------------------------------------------ PWA basics
  await step('manifest: name, standalone, rtl/ar, icons', async () => {
    const m = await (await fetch(`${BASE}/manifest.webmanifest`)).json();
    if (m.display !== 'standalone' || m.dir !== 'rtl' || m.lang !== 'ar' || m.icons.length < 3 || !m.start_url) throw new Error(JSON.stringify(m));
  });
  await step('service worker served with no-cache; SPA fallback; API not under fallback', async () => {
    const sw = await fetch(`${BASE}/sw.js`);
    if (!sw.ok || !/no-cache/.test(sw.headers.get('cache-control') ?? '')) throw new Error('sw.js headers');
    const deep = await fetch(`${BASE}/worker/requests/abc`);
    if (!(await deep.text()).includes('<div id="root">')) throw new Error('SPA fallback');
    const api = await fetch(`${BASE}/api/nope`);
    if (api.status !== 404 && api.status !== 401) throw new Error(`api status ${api.status}`);
  });
  await step('security headers (CSP, nosniff, frame-ancestors)', async () => {
    const r = await fetch(`${BASE}/`);
    const csp = r.headers.get('content-security-policy') ?? '';
    if (!csp.includes("frame-ancestors 'none'") || r.headers.get('x-content-type-options') !== 'nosniff') throw new Error(csp);
  });

  // Headless Chrome has no push service. E2E_HEADED=1 runs a real (off-screen) window so Web Push is delivered for real.
  const browser = await chromium.launch({
    channel: 'chrome',
    headless: !process.env.E2E_HEADED,
    args: process.env.E2E_HEADED ? ['--window-position=-32000,-32000'] : [],
    // Playwright disables background networking by default, which also disables Chrome's push service (GCM/FCM).
    ignoreDefaultArgs: process.env.E2E_HEADED ? ['--disable-background-networking', '--disable-component-update'] : [],
  });
  const managerCtx = await browser.newContext({ viewport: { width: 1366, height: 860 }, locale: 'ar' });
  const workerCtx = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    hasTouch: true,
    locale: 'ar',
    permissions: ['notifications'],
  });
  const manager = await managerCtx.newPage();
  const worker = await workerCtx.newPage();
  pages.push(manager, worker);
  for (const [name, p] of [
    ['manager', manager],
    ['worker', worker],
  ]) {
    p.on('pageerror', (e) => console.error(`  [${name} pageerror] ${e.message}`));
  }

  // ------------------------------------------------------------ worker login + push
  await step('worker: PIN login (mobile) and service worker controls the page', async () => {
    await worker.goto(BASE);
    await worker.getByText('أدخل رمز الدخول المكون من 4 أرقام').waitFor();
    await worker.screenshot({ path: join(shots, '01-login-mobile.png') });
    await pin(worker, '3001');
    await worker.getByRole('heading', { name: 'الطلبات الحالية' }).waitFor();
    await worker.waitForFunction(() => navigator.serviceWorker.ready.then(() => true));
  });

  let pushReady = false;
  await step(
    'worker: enable Web Push (real browser push service subscription)',
    async () => {
      await worker.getByRole('button', { name: 'تفعيل الإشعارات' }).click();
      await worker.getByText('الإشعارات مفعلة', { exact: false }).first().waitFor({ timeout: 20_000 }).catch(async () => {
        // Compact card hides once subscribed; check status via API instead.
      });
      const status = await worker.evaluate(() => fetch('/api/push/status').then((r) => r.json()));
      if (!status.subscribed) throw new Error('not subscribed (push service unavailable in this browser?)');
      pushReady = true;
    },
    { optional: true },
  );

  // ------------------------------------------------------------ manager sends a request
  await step('manager: PIN login → dashboard with stat cards', async () => {
    await manager.goto(BASE);
    await pin(manager, '2000');
    await manager.getByRole('heading', { name: 'لوحة التحكم' }).waitFor();
    await manager.getByText('العمال المتصلون').waitFor();
    await manager.screenshot({ path: join(shots, '02-manager-dashboard.png') });
  });

  let requestUrl = '';
  await step('manager: send request "إحضار المستندات" to أحمد with a photo', async () => {
    await manager.getByRole('button', { name: 'إرسال طلب جديد' }).click();
    await manager.getByPlaceholder('مثال: إحضار المستندات').fill('إحضار المستندات');
    await manager.getByRole('button', { name: /أحمد/ }).click();
    await manager.locator('input[type=file]').setInputFiles(imagePath);
    await manager.locator('img[src^="blob:"]').waitFor();
    await manager.screenshot({ path: join(shots, '03-new-request.png') });
    await manager.getByRole('button', { name: 'إرسال', exact: true }).click();
    await manager.waitForURL(/\/app\/requests\/[0-9a-f-]{36}$/);
    requestUrl = manager.url();
    await manager.getByRole('cell', { name: /أحمد/ }).waitFor();
    await manager.getByText('جديد').first().waitFor();
  });

  await step('manager: double-click "إرسال" creates exactly one request (idempotency)', async () => {
    await manager.goto(`${BASE}/app/requests/new`);
    await manager.getByPlaceholder('مثال: إحضار المستندات').fill('طلب اختبار التكرار');
    await manager.getByRole('radio', { name: 'جميع العمال' }).click();
    const send = manager.getByRole('button', { name: 'إرسال', exact: true });
    await send.dblclick();
    await manager.waitForURL(/\/app\/requests\/[0-9a-f-]{36}$/);
    const list = await manager.evaluate(() => fetch('/api/requests?q=' + encodeURIComponent('طلب اختبار التكرار')).then((r) => r.json()));
    if (list.total !== 1) throw new Error(`expected 1 request, got ${list.total}`);
    await manager.goto(requestUrl);
  });

  await step(
    'worker: push notification arrives — "طلب جديد من المدير ..." (one per request)',
    async () => {
      if (!pushReady) throw new Error('skipped: push not enabled');
      const titles = await worker.waitForFunction(
        async () => {
          const reg = await navigator.serviceWorker.ready;
          const list = await reg.getNotifications();
          return list.length >= 2 ? list.map((n) => n.title) : false;
        },
        null,
        { timeout: 45_000, polling: 1000 },
      );
      const value = await titles.jsonValue();
      if (!value.every((t) => t.startsWith('طلب جديد من المدير'))) throw new Error(JSON.stringify(value));
      const detail = await manager.evaluate((u) => fetch('/api/requests/' + u.split('/').pop()).then((r) => r.json()), requestUrl);
      const n = detail.notifications[0];
      if (!['SENT', 'DELIVERED'].includes(n.status)) throw new Error(`notification status ${n.status}`);
    },
    { optional: true },
  );

  // ------------------------------------------------------------ worker handles it
  await step('worker: new request card shown clearly with image; opening it records "opened"', async () => {
    await worker.goto(`${BASE}/worker`);
    await worker.getByText('إحضار المستندات').first().waitFor({ timeout: 20_000 });
    await worker.screenshot({ path: join(shots, '04-worker-home.png') });
    await worker.getByText('إحضار المستندات').first().click();
    await worker.getByRole('button', { name: 'تم الاستلام' }).waitFor();
    await worker.waitForFunction(() => [...document.images].some((i) => i.src.includes('/api/attachments/') && i.naturalWidth > 0));
    await worker.screenshot({ path: join(shots, '05-worker-request.png') });
  });

  await step('worker: "تم الاستلام" → manager sees أحمد — تم الاستلام live', async () => {
    await worker.getByRole('button', { name: 'تم الاستلام' }).click();
    await worker.getByRole('button', { name: 'تم التنفيذ' }).waitFor();
    await manager.getByRole('table').getByText('تم الاستلام').first().waitFor({ timeout: 15_000 });
  });

  await step('worker offline: "تم التنفيذ" is saved locally and queued', async () => {
    await workerCtx.setOffline(true);
    await worker.getByRole('button', { name: 'تم التنفيذ' }).click();
    await worker.getByText('بانتظار المزامنة').first().waitFor();
    await worker.screenshot({ path: join(shots, '06-worker-offline-queued.png') });
  });

  await step('worker offline: reload still opens the app from the service worker with cached data', async () => {
    await worker.reload();
    await worker.getByText('إحضار المستندات').first().waitFor({ timeout: 15_000 });
  });

  await step('reconnect: queued action syncs automatically → manager sees تم التنفيذ with timestamps', async () => {
    await workerCtx.setOffline(false);
    await worker.evaluate(() => window.dispatchEvent(new Event('online')));
    await worker.waitForFunction(() => !document.body.innerText.includes('بانتظار المزامنة'), null, { timeout: 30_000 });
    await manager.reload();
    await manager.getByRole('table').getByText('تم التنفيذ').first().waitFor({ timeout: 15_000 });
    const detail = await manager.evaluate((u) => fetch('/api/requests/' + u.split('/').pop()).then((r) => r.json()), requestUrl);
    const rc = detail.recipients[0];
    for (const k of ['openedAt', 'acknowledgedAt', 'completedAt']) if (!rc[k]) throw new Error(`${k} missing`);
    await manager.screenshot({ path: join(shots, '07-manager-request-detail.png'), fullPage: true });
  });

  await step('worker: previous requests + account page', async () => {
    await worker.goto(`${BASE}/worker/history`);
    await worker.getByText('إحضار المستندات').first().waitFor();
    await worker.goto(`${BASE}/worker/account`);
    await worker.getByRole('button', { name: 'تجربة الصوت والاهتزاز' }).waitFor();
    await worker.screenshot({ path: join(shots, '08-worker-account.png'), fullPage: true });
  });

  await step('manager: workers table shows presence; requests table + filters', async () => {
    await manager.goto(`${BASE}/app/workers`);
    await manager.getByRole('cell', { name: /أحمد/ }).waitFor();
    await manager.screenshot({ path: join(shots, '09-workers.png') });
    await manager.goto(`${BASE}/app/history?status=COMPLETED`);
    await manager.getByText('إحضار المستندات').first().waitFor();
    await manager.screenshot({ path: join(shots, '10-history.png') });
  });

  await step('manager: mobile layout (drawer navigation, no horizontal page overflow)', async () => {
    const phone = await managerCtx.newPage();
    await phone.setViewportSize({ width: 390, height: 844 });
    await phone.goto(`${BASE}/app`);
    await phone.getByRole('button', { name: 'القائمة' }).click();
    await phone.getByRole('link', { name: 'العمال', exact: true }).waitFor();
    await phone.screenshot({ path: join(shots, '11-manager-mobile-drawer.png') });
    const overflow = await phone.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
    if (overflow) throw new Error('horizontal overflow');
    await phone.close();
  });

  await step('system admin: managers, settings, login log, audit log', async () => {
    const adminCtx = await browser.newContext({ viewport: { width: 1366, height: 860 } });
    const admin = await adminCtx.newPage();
    pages.push(admin);
    await admin.goto(BASE);
    await pin(admin, '1000');
    await admin.getByRole('heading', { name: 'لوحة التحكم' }).waitFor();
    await admin.goto(`${BASE}/app/managers`);
    await admin.getByText('المدير محمد (تجريبي)').waitFor();
    await admin.screenshot({ path: join(shots, '12-admin-managers.png') });
    await admin.goto(`${BASE}/app/settings`);
    await admin.getByText('إعدادات الإشعارات والتنبيه').waitFor();
    await admin.screenshot({ path: join(shots, '13-admin-settings.png'), fullPage: true });
    await admin.goto(`${BASE}/app/logins`);
    await admin.getByRole('cell', { name: /أحمد/ }).first().waitFor();
    await admin.goto(`${BASE}/app/audit`);
    await admin.getByRole('cell', { name: 'استلام طلب' }).first().waitFor();
    await admin.screenshot({ path: join(shots, '14-admin-audit.png') });
    await adminCtx.close();
  });

  await step('manager role cannot reach admin pages (UI + API)', async () => {
    await manager.goto(`${BASE}/app/settings`);
    await manager.getByRole('heading', { name: 'لوحة التحكم' }).waitFor();
    const status = await manager.evaluate(() => fetch('/api/settings').then((r) => r.status));
    if (status !== 403) throw new Error(`status ${status}`);
  });

  await browser.close();
} catch (e) {
  failures++;
  console.error(e);
} finally {
  cleanup();
  console.log(`\n${results.join('\n')}\n\n${failures ? `${failures} step(s) FAILED` : 'All required steps passed'}  (screenshots: e2e/screenshots)`);
  process.exit(failures ? 1 : 0);
}
