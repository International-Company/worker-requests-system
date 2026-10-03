import { Injectable } from '@nestjs/common';
import { EventsService } from '../events/events.service';
import { PrismaService } from '../prisma/prisma.service';
import { SettingsService } from '../settings/settings.service';

/**
 * Online / last-seen tracking driven by a lightweight heartbeat sent by the worker
 * PWA while it is open. Only the latest snapshot is stored (no history).
 */
@Injectable()
export class PresenceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly events: EventsService,
  ) {}

  async heartbeat(userId: string, visible: boolean) {
    const now = new Date();
    const [threshold, interval] = await Promise.all([
      this.settings.get('presence.onlineThresholdSeconds'),
      this.settings.get('presence.heartbeatIntervalSeconds'),
    ]);
    const previous = await this.prisma.presence.findUnique({ where: { userId } });
    await this.prisma.presence.upsert({
      where: { userId },
      create: { userId, lastSeenAt: now, visible },
      update: { lastSeenAt: now, visible },
    });
    const wasOnline = previous ? this.isOnline(previous.lastSeenAt, threshold, now) : false;
    if (!wasOnline) this.events.emit({ type: 'presence.updated', managerId: null, data: { workerId: userId } });
    return { serverTime: now.toISOString(), heartbeatIntervalSeconds: interval };
  }

  /** Any authenticated worker activity (sync, acknowledge...) also counts as "seen". */
  async touch(userId: string): Promise<void> {
    const now = new Date();
    await this.prisma.presence.upsert({ where: { userId }, create: { userId, lastSeenAt: now }, update: { lastSeenAt: now } });
  }

  /** Explicit "going away" signal (tab hidden/closed) so the dashboard updates quickly. */
  async markHidden(userId: string): Promise<void> {
    await this.prisma.presence.updateMany({ where: { userId }, data: { visible: false } });
  }

  isOnline(lastSeenAt: Date | null | undefined, thresholdSeconds: number, now = new Date()): boolean {
    if (!lastSeenAt) return false;
    return now.getTime() - lastSeenAt.getTime() <= thresholdSeconds * 1000;
  }
}
