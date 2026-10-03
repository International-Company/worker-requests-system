import { Injectable } from '@nestjs/common';
import { Role } from '@prisma/client';
import { AuthUser } from '../common/auth/auth-user';
import { AppException } from '../common/errors/app.exception';
import { PinService } from '../common/security/pin.service';
import { DevicesService } from '../devices/devices.service';
import { EventsService } from '../events/events.service';
import { PrismaService } from '../prisma/prisma.service';
import { LoginDto } from './dto/auth.dto';
import { SessionService } from './session.service';

export interface RequestMeta {
  ip: string | null;
  userAgent: string | null;
}

export interface LoginResult {
  token: string;
  expiresAt: Date;
  user: { id: string; name: string; role: Role };
  deviceReplaced: boolean;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly pins: PinService,
    private readonly sessions: SessionService,
    private readonly devices: DevicesService,
    private readonly events: EventsService,
  ) {}

  /** One login for every role: the PIN is globally unique, the role decides the UI. */
  async login(dto: LoginDto, meta: RequestMeta): Promise<LoginResult> {
    const user = await this.prisma.user.findFirst({
      where: { pinHash: this.pins.hash(dto.pin), deletedAt: null },
    });
    if (!user) throw new AppException('INVALID_PIN');
    if (!user.isActive) throw new AppException('ACCOUNT_DISABLED');

    const result = await this.prisma.$transaction(async (tx) => {
      const { device, replaced } = await this.devices.bind(tx, user, dto.deviceKey, dto.deviceLabel ?? null, meta.ip);
      // A browser has one live session at a time.
      await tx.session.updateMany({ where: { deviceRowId: device.id, revokedAt: null }, data: { revokedAt: new Date() } });
      const session = await this.sessions.create(tx, {
        userId: user.id,
        role: user.role,
        deviceRowId: device.id,
        ip: meta.ip,
        userAgent: meta.userAgent,
      });
      const now = new Date();
      await tx.user.update({ where: { id: user.id }, data: { lastLoginAt: now } });
      if (user.role === Role.WORKER) {
        await tx.presence.upsert({
          where: { userId: user.id },
          create: { userId: user.id, lastSeenAt: now },
          update: { lastSeenAt: now, visible: true },
        });
      }
      await tx.loginLog.create({
        data: {
          userId: user.id,
          role: user.role,
          sessionId: session.sessionId,
          deviceKey: dto.deviceKey,
          ip: meta.ip,
          userAgent: meta.userAgent?.slice(0, 300),
        },
      });
      return { session, replaced };
    });

    if (user.role === Role.WORKER) {
      this.events.emit({ type: 'presence.updated', managerId: null, data: { workerId: user.id } });
    }
    return {
      token: result.session.token,
      expiresAt: result.session.expiresAt,
      user: { id: user.id, name: user.name, role: user.role },
      deviceReplaced: result.replaced > 0,
    };
  }

  /**
   * Logout ends the session. For workers the browser is also unbound so it stops
   * receiving request notifications.
   */
  async logout(user: AuthUser): Promise<void> {
    if (user.role === Role.WORKER) {
      await this.prisma.$transaction((tx) => this.devices.revokeRow(tx, user.deviceRowId, 'LOGOUT'));
    }
    await this.sessions.revoke(user.sessionId);
  }

  async me(user: AuthUser) {
    const row = await this.prisma.user.findUniqueOrThrow({
      where: { id: user.id },
      select: {
        id: true,
        name: true,
        role: true,
        lastLoginAt: true,
        worker: { select: { phone: true, photoEtag: true } },
      },
    });
    const device = await this.prisma.device.findUnique({
      where: { id: user.deviceRowId },
      select: { id: true, label: true, boundAt: true },
    });
    return {
      id: row.id,
      name: row.name,
      role: row.role,
      lastLoginAt: row.lastLoginAt,
      phone: row.worker?.phone ?? null,
      photoVersion: row.worker?.photoEtag ?? null,
      device,
      serverTime: new Date().toISOString(),
    };
  }
}
