import { Inject, Injectable, Logger } from '@nestjs/common';
import * as webpush from 'web-push';
import { APP_CONFIG, AppConfig } from '../config/app-config';
import { PushPayload, PushProvider, PushResult, PushTarget } from './push.types';

/**
 * Standard Web Push (RFC 8030 + VAPID RFC 8292, payload encryption RFC 8291).
 * Works with every browser push service: FCM (Chrome/Edge/Android), Mozilla autopush,
 * Apple Web Push (Safari / iOS 16.4+ installed PWAs). No Firebase project is required.
 */
@Injectable()
export class WebPushProvider implements PushProvider {
  private readonly logger = new Logger('WebPush');
  readonly enabled: boolean;
  readonly publicKey: string | null;

  constructor(@Inject(APP_CONFIG) config: AppConfig) {
    if (!config.vapid) {
      this.enabled = false;
      this.publicKey = null;
      return;
    }
    webpush.setVapidDetails(config.vapid.subject, config.vapid.publicKey, config.vapid.privateKey);
    this.enabled = true;
    this.publicKey = config.vapid.publicKey;
    this.logger.log('Web Push (VAPID) enabled');
  }

  async send(target: PushTarget, payload: PushPayload, ttlSeconds: number): Promise<PushResult> {
    if (!this.enabled) return { ok: false, error: 'PUSH_DISABLED', subscriptionGone: false, retryable: false };
    try {
      await webpush.sendNotification(
        { endpoint: target.endpoint, keys: { p256dh: target.p256dh, auth: target.auth } },
        JSON.stringify(payload),
        { TTL: ttlSeconds, urgency: 'high', topic: undefined, timeout: 10_000 },
      );
      return { ok: true };
    } catch (e) {
      const statusCode = (e as { statusCode?: number }).statusCode;
      // 404/410: subscription expired or unsubscribed → must be removed.
      const subscriptionGone = statusCode === 404 || statusCode === 410;
      // 429/5xx/network: transient → retry with backoff.
      const retryable = !subscriptionGone && (statusCode === undefined || statusCode === 429 || statusCode >= 500);
      const error = statusCode ? `HTTP_${statusCode}` : ((e as Error).message ?? 'unknown').slice(0, 200);
      this.logger.warn(`Push failed (${error})${subscriptionGone ? ' — subscription gone' : ''}`);
      return { ok: false, error, subscriptionGone, retryable };
    }
  }
}
