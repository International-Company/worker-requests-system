import { BeforeApplicationShutdown, Inject, Injectable, Logger } from '@nestjs/common';
import { NotificationStatus, NotificationType, RecipientStatus, RequestStatus } from '@prisma/client';
import { EventsService } from '../events/events.service';
import { PrismaService } from '../prisma/prisma.service';
import { PUSH_PROVIDER, PushPayload, PushProvider } from '../push/push.types';
import { SettingsService } from '../settings/settings.service';
import { notificationText } from './notification-texts';

/** Transient push failures are retried with exponential backoff, at most this many attempts. */
export const MAX_PUSH_ATTEMPTS = 3;
const BACKOFF_SECONDS = [30, 120, 600];

/** Alerting types keep the notification on screen until the worker interacts with it. */
const STICKY_TYPES = new Set<NotificationType>([
  NotificationType.NEW_REQUEST,
  NotificationType.REMINDER,
  NotificationType.REQUEST_REOPENED,
]);

/**
 * Notification workflow:
 *   request committed → one Notification row per recipient → Web Push → status SENT/FAILED/SKIPPED
 *   service worker receives the push → POST /notifications/:id/delivered → DELIVERED
 *   worker opens the request → recipient.openedAt
 */
@Injectable()
export class NotificationsService implements BeforeApplicationShutdown {
  private readonly logger = new Logger(NotificationsService.name);
  private readonly inFlight = new Set<Promise<void>>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly events: EventsService,
    @Inject(PUSH_PROVIDER) private readonly push: PushProvider,
  ) {}

  /** Fire-and-forget entry point used after a DB transaction commits. Never throws. */
  dispatchInBackground(recipientIds: string[], type: NotificationType): void {
    const job = this.dispatch(recipientIds, type)
      .catch((e) => this.logger.error(`Notification dispatch failed (${type})`, (e as Error).stack))
      .finally(() => this.inFlight.delete(job));
    this.inFlight.add(job);
  }

  /** Graceful shutdown: let pushes that already started finish (records stay consistent). */
  async beforeApplicationShutdown(): Promise<void> {
    await this.drain();
  }

  async drain(): Promise<void> {
    while (this.inFlight.size) await Promise.allSettled([...this.inFlight]);
  }

  async dispatch(recipientIds: string[], type: NotificationType): Promise<void> {
    for (const recipientId of recipientIds) {
      await this.notifyRecipient(recipientId, type);
    }
  }

  async notifyRecipient(recipientId: string, type: NotificationType): Promise<NotificationStatus> {
    const recipient = await this.prisma.requestRecipient.findUnique({
      where: { id: recipientId },
      include: {
        worker: { select: { id: true, isActive: true, deletedAt: true } },
        request: { select: { number: true, title: true, createdBy: { select: { name: true } } } },
      },
    });
    if (!recipient) return NotificationStatus.SKIPPED;

    const device = await this.prisma.device.findFirst({
      where: { userId: recipient.workerId, isActive: true },
      select: { id: true },
    });
    const notification = await this.prisma.notification.create({
      data: { recipientId, userId: recipient.workerId, deviceRowId: device?.id ?? null, type },
    });
    if (type === NotificationType.NEW_REQUEST || type === NotificationType.REMINDER) {
      await this.prisma.requestRecipient.update({
        where: { id: recipientId },
        data: {
          lastNotifiedAt: new Date(),
          ...(type === NotificationType.REMINDER ? { reminderCount: { increment: 1 } } : {}),
        },
      });
    }

    if (!recipient.worker.isActive || recipient.worker.deletedAt) {
      return this.finish(notification.id, NotificationStatus.SKIPPED, 'WORKER_INACTIVE');
    }
    if (!this.push.enabled) return this.finish(notification.id, NotificationStatus.SKIPPED, 'PUSH_DISABLED');
    if (!device) return this.finish(notification.id, NotificationStatus.SKIPPED, 'NO_DEVICE');

    const { title, body } = notificationText(type, recipient.request.createdBy.name, recipient.request.title);
    const payload: PushPayload = {
      type,
      notificationId: notification.id,
      recipientId,
      requestNumber: recipient.request.number,
      title,
      body,
      url: `/worker/requests/${recipientId}`,
      tag: `request-${recipientId}`,
      requireInteraction: STICKY_TYPES.has(type),
      sentAt: new Date().toISOString(),
    };
    return this.attempt(notification.id, device.id, payload);
  }

  /** Called by the service worker when the push arrived on the device. */
  async markDelivered(notificationId: string, userId: string): Promise<void> {
    const n = await this.prisma.notification.findFirst({ where: { id: notificationId, userId } });
    if (!n) return;
    const now = new Date();
    await this.prisma.$transaction([
      this.prisma.notification.update({
        where: { id: n.id },
        data: { status: NotificationStatus.DELIVERED, deliveredAt: n.deliveredAt ?? now },
      }),
      this.prisma.requestRecipient.updateMany({
        where: { id: n.recipientId, deliveredAt: null },
        data: { deliveredAt: now },
      }),
    ]);
    const req = await this.prisma.requestRecipient.findUnique({
      where: { id: n.recipientId },
      select: { requestId: true, request: { select: { createdById: true } } },
    });
    if (req) {
      this.events.emit({ type: 'recipient.updated', managerId: req.request.createdById, data: { requestId: req.requestId } });
    }
  }

  /**
   * Reminder policy: a recipient still NEW and never opened is re-notified every
   * `notifications.reminderIntervalSeconds` (default 5 min), at most
   * `notifications.maxReminders` times (default 3). No unlimited notifications.
   */
  async sendDueReminders(now = new Date()): Promise<number> {
    const [interval, maxReminders] = await Promise.all([
      this.settings.get('notifications.reminderIntervalSeconds'),
      this.settings.get('notifications.maxReminders'),
    ]);
    if (maxReminders <= 0) return 0;
    const due = await this.prisma.requestRecipient.findMany({
      where: {
        status: RecipientStatus.NEW,
        openedAt: null,
        reminderCount: { lt: maxReminders },
        lastNotifiedAt: { lte: new Date(now.getTime() - interval * 1000) },
        request: { status: RequestStatus.ACTIVE },
        worker: { isActive: true, deletedAt: null },
      },
      select: { id: true },
      take: 200,
    });
    for (const r of due) await this.notifyRecipient(r.id, NotificationType.REMINDER);
    return due.length;
  }

  /** Re-attempts transiently failed pushes whose backoff has elapsed. */
  async retryPending(now = new Date()): Promise<number> {
    const pending = await this.prisma.notification.findMany({
      where: { status: NotificationStatus.PENDING, nextAttemptAt: { lte: now }, attempts: { gt: 0, lt: MAX_PUSH_ATTEMPTS } },
      include: {
        recipient: {
          select: { status: true, request: { select: { number: true, title: true, status: true, createdBy: { select: { name: true } } } } },
        },
      },
      take: 100,
    });
    for (const n of pending) {
      // Do not retry stale alerts for requests that were handled or cancelled meanwhile.
      const stale =
        n.type !== NotificationType.REQUEST_CANCELLED &&
        (n.recipient.request.status === RequestStatus.CANCELLED || n.recipient.status === RecipientStatus.COMPLETED);
      if (stale || !n.deviceRowId) {
        await this.finish(n.id, NotificationStatus.SKIPPED, stale ? 'STALE' : 'NO_DEVICE');
        continue;
      }
      const { title, body } = notificationText(n.type, n.recipient.request.createdBy.name, n.recipient.request.title);
      await this.attempt(n.id, n.deviceRowId, {
        type: n.type,
        notificationId: n.id,
        recipientId: n.recipientId,
        requestNumber: n.recipient.request.number,
        title,
        body,
        url: `/worker/requests/${n.recipientId}`,
        tag: `request-${n.recipientId}`,
        requireInteraction: STICKY_TYPES.has(n.type),
        sentAt: new Date().toISOString(),
      });
    }
    return pending.length;
  }

  async listForRecipient(recipientId: string) {
    return this.prisma.notification.findMany({
      where: { recipientId },
      orderBy: { createdAt: 'asc' },
      select: { id: true, type: true, status: true, error: true, attempts: true, sentAt: true, deliveredAt: true, createdAt: true },
    });
  }

  private async attempt(notificationId: string, deviceRowId: string, payload: PushPayload): Promise<NotificationStatus> {
    const subscription = await this.prisma.pushSubscription.findFirst({
      where: { deviceRowId, isActive: true, device: { isActive: true } },
      orderBy: { createdAt: 'desc' },
    });
    const current = await this.prisma.notification.update({
      where: { id: notificationId },
      data: { attempts: { increment: 1 } },
      select: { attempts: true },
    });
    if (!subscription) return this.finish(notificationId, NotificationStatus.SKIPPED, 'NO_SUBSCRIPTION');

    const ttl = await this.settings.get('notifications.ttlSeconds');
    const result = await this.push.send(subscription, payload, ttl);
    if (result.ok) {
      await this.prisma.$transaction([
        this.prisma.notification.update({
          where: { id: notificationId },
          data: { status: NotificationStatus.SENT, sentAt: new Date(), error: null, nextAttemptAt: null },
        }),
        this.prisma.pushSubscription.update({
          where: { id: subscription.id },
          data: { lastSuccessAt: new Date(), failCount: 0 },
        }),
      ]);
      return NotificationStatus.SENT;
    }

    if (result.subscriptionGone) {
      // Clean up invalid/expired subscriptions so they are never used again.
      await this.prisma.pushSubscription.update({
        where: { id: subscription.id },
        data: { isActive: false, disabledAt: new Date(), disabledReason: result.error },
      });
      return this.finish(notificationId, NotificationStatus.FAILED, `SUBSCRIPTION_GONE:${result.error}`);
    }

    await this.prisma.pushSubscription.update({ where: { id: subscription.id }, data: { failCount: { increment: 1 } } });
    if (result.retryable && current.attempts < MAX_PUSH_ATTEMPTS) {
      const delay = BACKOFF_SECONDS[current.attempts - 1] ?? BACKOFF_SECONDS[BACKOFF_SECONDS.length - 1];
      await this.prisma.notification.update({
        where: { id: notificationId },
        data: { status: NotificationStatus.PENDING, error: result.error, nextAttemptAt: new Date(Date.now() + delay * 1000) },
      });
      return NotificationStatus.PENDING;
    }
    return this.finish(notificationId, NotificationStatus.FAILED, result.error);
  }

  private async finish(id: string, status: NotificationStatus, error: string | null): Promise<NotificationStatus> {
    await this.prisma.notification.update({
      where: { id },
      data: { status, error: error?.slice(0, 300) ?? null, nextAttemptAt: null },
    });
    return status;
  }
}
