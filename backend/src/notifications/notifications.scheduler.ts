import { Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { NotificationsService } from './notifications.service';

/**
 * Background jobs. Each job is guarded against overlapping runs.
 * Assumes a single backend instance (Railway default). For horizontal scaling,
 * wrap each run in a Postgres advisory lock.
 */
@Injectable()
export class NotificationsScheduler {
  private readonly logger = new Logger(NotificationsScheduler.name);
  private running = { reminders: false, retries: false };

  constructor(private readonly notifications: NotificationsService) {}

  @Interval('notification-reminders', 30_000)
  async reminders(): Promise<void> {
    await this.guard('reminders', async () => {
      const n = await this.notifications.sendDueReminders();
      if (n) this.logger.log(`Sent ${n} reminder(s)`);
    });
  }

  @Interval('notification-retries', 15_000)
  async retries(): Promise<void> {
    await this.guard('retries', async () => {
      const n = await this.notifications.retryPending();
      if (n) this.logger.log(`Retried ${n} push(es)`);
    });
  }

  private async guard(name: keyof NotificationsScheduler['running'], fn: () => Promise<void>) {
    if (this.running[name]) return;
    this.running[name] = true;
    try {
      await fn();
    } catch (e) {
      this.logger.error(`Job ${name} failed`, (e as Error).stack);
    } finally {
      this.running[name] = false;
    }
  }
}
