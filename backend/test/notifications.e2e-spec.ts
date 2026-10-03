import { NotificationStatus, Role } from '@prisma/client';
import { randomUUID } from 'crypto';
import { NotificationsService } from '../src/notifications/notifications.service';
import { Client, createHarness, eventually, Harness, subscribe } from './helpers/harness';

describe('Web Push notification workflow (e2e)', () => {
  let h: Harness;
  let manager: Client;
  let worker: Client;
  let workerId: string;
  let notifications: NotificationsService;

  beforeAll(async () => {
    h = await createHarness();
    notifications = h.get(NotificationsService);
  });
  afterAll(async () => {
    await h.close();
  });
  beforeEach(async () => {
    await h.reset();
    await h.createUser(Role.MANAGER, '2000', 'محمد');
    workerId = (await h.createUser(Role.WORKER, '3001', 'أحمد')).id;
    manager = await h.login('2000');
    worker = await h.login('3001');
  });

  const send = async (title = 'إحضار المستندات') =>
    (await manager.post('/api/requests', { idempotencyKey: randomUUID(), title, targetType: 'SINGLE', workerIds: [workerId] })).body;

  it('sends one push per request with manager name, title and a deep link', async () => {
    const endpoint = await subscribe(worker);
    const req = await send();
    await h.drain();
    expect(h.push.sent).toHaveLength(1);
    const { target, payload } = h.push.sent[0];
    expect(target.endpoint).toBe(endpoint);
    expect(payload).toMatchObject({
      type: 'NEW_REQUEST',
      title: 'طلب جديد من المدير محمد',
      body: 'إحضار المستندات',
      url: `/worker/requests/${req.recipients[0].id}`,
      requireInteraction: true,
    });
    const row = await h.prisma.notification.findUniqueOrThrow({ where: { id: payload.notificationId } });
    expect(row.status).toBe(NotificationStatus.SENT);
    expect(row.sentAt).toBeTruthy();
  });

  it('separate requests produce separate notifications (distinct tags)', async () => {
    await subscribe(worker);
    await send('الطلب الأول');
    await send('الطلب الثاني');
    await h.drain();
    const tags = h.push.sent.map((s) => s.payload.tag);
    expect(tags).toHaveLength(2);
    expect(new Set(tags).size).toBe(2);
  });

  it('records SKIPPED when the worker has not enabled notifications (request is still stored)', async () => {
    const req = await send();
    await h.drain();
    expect(h.push.sent).toHaveLength(0);
    const n = await h.prisma.notification.findFirstOrThrow({ where: { recipientId: req.recipients[0].id } });
    expect(n).toMatchObject({ status: 'SKIPPED', error: 'NO_SUBSCRIPTION' });
    expect((await worker.get('/api/worker/requests')).body.items).toHaveLength(1);
  });

  it('removes invalid / expired subscriptions (HTTP 410)', async () => {
    const endpoint = await subscribe(worker);
    h.push.failNext({ ok: false, error: 'HTTP_410', subscriptionGone: true, retryable: false });
    await send();
    await h.drain();
    const sub = await h.prisma.pushSubscription.findUniqueOrThrow({ where: { endpoint } });
    expect(sub.isActive).toBe(false);
    expect(sub.disabledReason).toBe('HTTP_410');
    expect((await h.prisma.notification.findFirstOrThrow()).status).toBe('FAILED');
    expect((await worker.get('/api/push/status')).body.subscribed).toBe(false);
  });

  it('retries transient failures with backoff, max 3 attempts', async () => {
    await subscribe(worker);
    const fail = { ok: false as const, error: 'HTTP_503', subscriptionGone: false, retryable: true };
    h.push.failNext(fail, fail, fail);
    await send();
    await h.drain();
    let n = await h.prisma.notification.findFirstOrThrow();
    expect(n).toMatchObject({ status: 'PENDING', attempts: 1 });
    expect(n.nextAttemptAt!.getTime()).toBeGreaterThan(Date.now());

    const later = new Date(Date.now() + 3600_000);
    await notifications.retryPending(later);
    await notifications.retryPending(later);
    n = await h.prisma.notification.findFirstOrThrow();
    expect(n).toMatchObject({ status: 'FAILED', attempts: 3 });
    expect(await notifications.retryPending(later)).toBe(0);
    expect(h.push.sent).toHaveLength(3);
  });

  it('a retry succeeds after a transient failure', async () => {
    await subscribe(worker);
    h.push.failNext({ ok: false, error: 'HTTP_500', subscriptionGone: false, retryable: true });
    await send();
    await h.drain();
    await notifications.retryPending(new Date(Date.now() + 3600_000));
    expect((await h.prisma.notification.findFirstOrThrow()).status).toBe('SENT');
  });

  it('reminds an unopened request every interval, but never more than maxReminders', async () => {
    await subscribe(worker);
    const req = await send();
    await h.drain();
    const rid = req.recipients[0].id;
    const past = new Date(Date.now() - 10 * 60_000);

    for (let i = 0; i < 5; i++) {
      await h.prisma.requestRecipient.update({ where: { id: rid }, data: { lastNotifiedAt: past } });
      await notifications.sendDueReminders();
    }
    const reminders = h.push.sent.filter((s) => s.payload.type === 'REMINDER');
    expect(reminders).toHaveLength(3); // default maxReminders
    expect(reminders[0].payload.tag).toBe(`request-${rid}`); // re-alerts the same notification
  });

  it('no reminder before the interval elapses, nor once the worker opened the request', async () => {
    await subscribe(worker);
    const req = await send();
    await h.drain();
    expect(await notifications.sendDueReminders()).toBe(0);
    await worker.post(`/api/worker/requests/${req.recipients[0].id}/open`);
    await h.prisma.requestRecipient.update({ where: { id: req.recipients[0].id }, data: { lastNotifiedAt: new Date(0) } });
    expect(await notifications.sendDueReminders()).toBe(0);
  });

  it('respects the reminder settings managed by the system admin', async () => {
    await h.createUser(Role.SYSTEM_ADMIN, '1000');
    const admin = await h.login('1000');
    const res = await admin.patch('/api/settings', { values: { 'notifications.maxReminders': 0 } });
    expect(res.status).toBe(200);
    const bad = await admin.patch('/api/settings', { values: { 'notifications.reminderIntervalSeconds': 5 } });
    expect(bad.body.code).toBe('INVALID_SETTING');
    await subscribe(worker);
    const req = await send();
    await h.drain();
    await h.prisma.requestRecipient.update({ where: { id: req.recipients[0].id }, data: { lastNotifiedAt: new Date(0) } });
    expect(await notifications.sendDueReminders()).toBe(0);
  });

  it('delivery receipt from the service worker marks DELIVERED and recipient.deliveredAt', async () => {
    await subscribe(worker);
    const req = await send();
    await h.drain();
    const { notificationId } = h.push.sent[0].payload;
    expect((await worker.post(`/api/notifications/${notificationId}/delivered`)).status).toBe(204);
    expect((await h.prisma.notification.findUniqueOrThrow({ where: { id: notificationId } })).status).toBe('DELIVERED');
    const detail = (await manager.get(`/api/requests/${req.id}`)).body;
    expect(detail.recipients[0].deliveredAt).toBeTruthy();
    expect(detail.notifications[0]).toMatchObject({ type: 'NEW_REQUEST', status: 'DELIVERED' });
  });

  it('edit, cancel and reopen notify the worker', async () => {
    await subscribe(worker);
    const req = await send();
    await manager.patch(`/api/requests/${req.id}`, { title: 'عنوان معدل' });
    await h.drain();
    expect(h.push.sent.map((s) => s.payload.type)).toEqual(['NEW_REQUEST', 'REQUEST_UPDATED']);
    expect(h.push.sent[1].payload.title).toBe('تم تعديل الطلب');

    await manager.post(`/api/requests/${req.id}/cancel`);
    await h.drain();
    expect(h.push.sent[2].payload).toMatchObject({ type: 'REQUEST_CANCELLED', requireInteraction: false });

    const req2 = await send('ثاني');
    const rid = req2.recipients[0].id;
    await worker.post(`/api/worker/requests/${rid}/acknowledge`);
    await worker.post(`/api/worker/requests/${rid}/complete`);
    await manager.post(`/api/requests/${req2.id}/reopen`);
    await h.drain();
    expect(h.push.sent.at(-1)!.payload.type).toBe('REQUEST_REOPENED');
  });

  it('never notifies a disconnected device', async () => {
    await subscribe(worker);
    expect((await manager.post(`/api/workers/${workerId}/disconnect-device`)).status).toBe(204);
    const req = await send();
    await h.drain();
    expect(h.push.sent).toHaveLength(0);
    const n = await h.prisma.notification.findFirstOrThrow({ where: { recipientId: req.recipients[0].id } });
    expect(n.error).toBe('NO_DEVICE');
    expect((await worker.get('/api/worker/requests')).status).toBe(401);
  });

  it('device replacement: only the new browser receives pushes', async () => {
    await subscribe(worker, 'https://push.example.com/old');
    const newPhone = await h.login('3001');
    await subscribe(newPhone, 'https://push.example.com/new');
    await send();
    await h.drain();
    expect(h.push.sent.map((s) => s.target.endpoint)).toEqual(['https://push.example.com/new']);
  });

  it('subscribing again replaces the previous subscription of the same browser', async () => {
    await subscribe(worker, 'https://push.example.com/a');
    await subscribe(worker, 'https://push.example.com/b');
    const active = await h.prisma.pushSubscription.findMany({ where: { isActive: true } });
    expect(active.map((s) => s.endpoint)).toEqual(['https://push.example.com/b']);
    expect((await worker.delete('/api/push/subscribe', { endpoint: 'https://push.example.com/b' })).status).toBe(204);
    expect(await h.prisma.pushSubscription.count({ where: { isActive: true } })).toBe(0);
  });
});
