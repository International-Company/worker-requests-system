import { Inject, Injectable } from '@nestjs/common';
import { Device, Prisma, Role } from '@prisma/client';
import { AuditAction } from '../audit/audit-actions';
import { AuditService } from '../audit/audit.service';
import { AppException } from '../common/errors/app.exception';
import { EventsService } from '../events/events.service';
import { PrismaService } from '../prisma/prisma.service';
import { PUSH_PROVIDER, PushProvider } from '../push/push.types';

export type RevokeReason = 'REPLACED' | 'REASSIGNED' | 'DISCONNECTED' | 'LOGOUT' | 'USER_DISABLED';

export interface PushSubscriptionInput {
  endpoint: string;
  p256dh: string;
  auth: string;
}

type Actor = { id: string; role: Role };

/**
 * A "device" is a browser / installed PWA, identified by a random key the browser keeps.
 * Workers: exactly one active device (login elsewhere disconnects the previous one).
 * Staff: may be signed in on several browsers.
 */
@Injectable()
export class DevicesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly events: EventsService,
    @Inject(PUSH_PROVIDER) private readonly push: PushProvider,
  ) {}

  get vapidPublicKey(): string | null {
    return this.push.publicKey;
  }

  /** Must be called inside the login transaction. */
  async bind(
    tx: Prisma.TransactionClient,
    user: { id: string; role: Role },
    deviceKey: string,
    label: string | null,
    ip: string | null,
  ): Promise<{ device: Device; replaced: number }> {
    const now = new Date();
    // Serialise concurrent logins of the same user (guarantees "one active device per worker").
    await tx.$queryRaw`SELECT id FROM users WHERE id = ${user.id}::uuid FOR UPDATE`;
    // Same browser previously used by another account (shared phone): unbind it,
    // otherwise that account's requests would keep arriving on this browser.
    const conflicts = await tx.device.findMany({
      where: {
        isActive: true,
        OR: [
          { deviceKey, NOT: { userId: user.id } },
          ...(user.role === Role.WORKER ? [{ userId: user.id, NOT: { deviceKey } }] : []),
        ],
      },
      select: { id: true, userId: true, deviceKey: true },
    });
    for (const d of conflicts) {
      const reason: RevokeReason = d.userId === user.id ? 'REPLACED' : 'REASSIGNED';
      await this.revokeRow(tx, d.id, reason, now);
      await this.audit.record(
        {
          actorId: user.id,
          actorRole: user.role,
          action: AuditAction.DEVICE_REPLACED,
          entityType: 'device',
          entityId: d.id,
          metadata: { reason, userId: d.userId },
          ip,
        },
        tx,
      );
    }

    const existing = await tx.device.findFirst({ where: { userId: user.id, deviceKey, isActive: true } });
    const device = existing
      ? await tx.device.update({ where: { id: existing.id }, data: { lastSeenAt: now, label } })
      : await tx.device.create({ data: { userId: user.id, deviceKey, label, boundAt: now, lastSeenAt: now } });
    if (!existing) {
      await this.audit.record(
        { actorId: user.id, actorRole: user.role, action: AuditAction.DEVICE_BOUND, entityType: 'device', entityId: device.id, metadata: { label }, ip },
        tx,
      );
    }
    return { device, replaced: conflicts.filter((c) => c.userId === user.id).length };
  }

  /** Stores/moves the browser's Web Push subscription to this device. */
  async subscribe(deviceRowId: string, sub: PushSubscriptionInput): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      // A subscription endpoint belongs to one browser profile: keep only one active device per endpoint.
      await tx.pushSubscription.upsert({
        where: { endpoint: sub.endpoint },
        create: { deviceRowId, endpoint: sub.endpoint, p256dh: sub.p256dh, auth: sub.auth },
        update: {
          deviceRowId,
          p256dh: sub.p256dh,
          auth: sub.auth,
          isActive: true,
          failCount: 0,
          disabledAt: null,
          disabledReason: null,
        },
      });
      // Older subscriptions of the same device are superseded.
      await tx.pushSubscription.updateMany({
        where: { deviceRowId, isActive: true, NOT: { endpoint: sub.endpoint } },
        data: { isActive: false, disabledAt: new Date(), disabledReason: 'SUPERSEDED' },
      });
    });
  }

  async unsubscribe(deviceRowId: string, endpoint: string): Promise<void> {
    await this.prisma.pushSubscription.updateMany({
      where: { deviceRowId, endpoint, isActive: true },
      data: { isActive: false, disabledAt: new Date(), disabledReason: 'UNSUBSCRIBED' },
    });
  }

  async pushStatus(deviceRowId: string) {
    const count = await this.prisma.pushSubscription.count({ where: { deviceRowId, isActive: true } });
    return { enabled: this.push.enabled, subscribed: count > 0, vapidPublicKey: this.push.publicKey };
  }

  /** Manual "فصل الجهاز" (lost phone, etc.): all active devices of the user are revoked. */
  async disconnectUser(userId: string, actor: Actor, ip: string | null): Promise<number> {
    const user = await this.prisma.user.findFirst({ where: { id: userId, deletedAt: null } });
    if (!user) throw new AppException('NOT_FOUND');
    if (user.role !== Role.WORKER && actor.role !== Role.SYSTEM_ADMIN) throw new AppException('FORBIDDEN');
    const count = await this.prisma.$transaction(async (tx) => {
      const devices = await tx.device.findMany({ where: { userId, isActive: true }, select: { id: true, label: true } });
      for (const d of devices) await this.revokeRow(tx, d.id, 'DISCONNECTED', new Date());
      await tx.session.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() } });
      await this.audit.record(
        {
          actorId: actor.id,
          actorRole: actor.role,
          action: AuditAction.DEVICE_DISCONNECTED,
          entityType: user.role === Role.WORKER ? 'worker' : 'staff',
          entityId: userId,
          metadata: { devices: devices.length },
          ip,
        },
        tx,
      );
      return devices.length;
    });
    this.events.emit({ type: 'worker.updated', managerId: null, data: { workerId: userId } });
    return count;
  }

  /** Revokes every device + session of a user (account disabled / deleted). */
  async revokeAllForUser(tx: Prisma.TransactionClient, userId: string, reason: RevokeReason): Promise<void> {
    const devices = await tx.device.findMany({ where: { userId, isActive: true }, select: { id: true } });
    for (const d of devices) await this.revokeRow(tx, d.id, reason, new Date());
    await tx.session.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() } });
  }

  async revokeRow(tx: Prisma.TransactionClient, deviceRowId: string, reason: RevokeReason, now = new Date()): Promise<void> {
    await tx.device.update({
      where: { id: deviceRowId },
      data: { isActive: false, revokedAt: now, revokedReason: reason },
    });
    await tx.session.updateMany({ where: { deviceRowId, revokedAt: null }, data: { revokedAt: now } });
    await tx.pushSubscription.updateMany({
      where: { deviceRowId, isActive: true },
      data: { isActive: false, disabledAt: now, disabledReason: `DEVICE_${reason}` },
    });
  }
}
