import * as webpush from 'web-push';
import { loadConfig } from '../config/app-config';
import { WebPushProvider } from './web-push.provider';

jest.mock('web-push', () => ({ setVapidDetails: jest.fn(), sendNotification: jest.fn() }));
const send = webpush.sendNotification as jest.Mock;

const baseEnv = {
  AUTH_SECRET: 'x'.repeat(40),
  DATABASE_URL: 'postgresql://localhost/db',
  NODE_ENV: 'test',
};
const target = { endpoint: 'https://push.example/1', p256dh: 'p', auth: 'a' };
const payload = {
  type: 'NEW_REQUEST' as const,
  notificationId: 'n',
  recipientId: 'r',
  requestNumber: 1,
  title: 'طلب جديد من المدير محمد',
  body: 'إحضار المستندات',
  url: '/worker/requests/r',
  tag: 'request-r',
  requireInteraction: true,
  sentAt: new Date().toISOString(),
};

describe('WebPushProvider', () => {
  const provider = new WebPushProvider(loadConfig({ ...baseEnv, VAPID_PUBLIC_KEY: 'pub', VAPID_PRIVATE_KEY: 'priv' }));
  beforeEach(() => send.mockReset());

  it('is disabled without VAPID keys', async () => {
    const disabled = new WebPushProvider(loadConfig(baseEnv));
    expect(disabled.enabled).toBe(false);
    expect(await disabled.send(target, payload, 60)).toMatchObject({ ok: false, error: 'PUSH_DISABLED' });
  });

  it('sends an encrypted JSON payload with high urgency and TTL', async () => {
    send.mockResolvedValue({ statusCode: 201 });
    expect(await provider.send(target, payload, 600)).toEqual({ ok: true });
    const [sub, body, options] = send.mock.calls[0];
    expect(sub).toEqual({ endpoint: target.endpoint, keys: { p256dh: 'p', auth: 'a' } });
    expect(JSON.parse(body)).toMatchObject({ title: payload.title, url: payload.url });
    expect(options).toMatchObject({ TTL: 600, urgency: 'high' });
  });

  it.each([404, 410])('HTTP %i → subscription gone (to be cleaned up)', async (statusCode) => {
    send.mockRejectedValue(Object.assign(new Error('gone'), { statusCode }));
    expect(await provider.send(target, payload, 60)).toEqual({ ok: false, error: `HTTP_${statusCode}`, subscriptionGone: true, retryable: false });
  });

  it.each([429, 500, 503])('HTTP %i → retryable', async (statusCode) => {
    send.mockRejectedValue(Object.assign(new Error('x'), { statusCode }));
    expect(await provider.send(target, payload, 60)).toMatchObject({ ok: false, subscriptionGone: false, retryable: true });
  });

  it('network errors are retryable; 400/403 are not', async () => {
    send.mockRejectedValueOnce(new Error('ECONNRESET'));
    expect(await provider.send(target, payload, 60)).toMatchObject({ retryable: true });
    send.mockRejectedValueOnce(Object.assign(new Error('bad'), { statusCode: 403 }));
    expect(await provider.send(target, payload, 60)).toMatchObject({ retryable: false, subscriptionGone: false });
  });
});
