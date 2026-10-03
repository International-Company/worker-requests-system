import { Inject, Injectable } from '@nestjs/common';
import { Prisma, Role } from '@prisma/client';
import { AuthUser } from '../common/auth/auth-user';
import { AppException } from '../common/errors/app.exception';
import { randomToken } from '../common/security/crypto.util';
import { PinService } from '../common/security/pin.service';
import { APP_CONFIG, AppConfig } from '../config/app-config';
import { PrismaService } from '../prisma/prisma.service';

/** "Last activity" and sliding expiry are written at most this often per session. */
const TOUCH_INTERVAL_MS = 60_000;

/**
 * Opaque server-side sessions. The browser holds a 256-bit random token in an
 * httpOnly + Secure + SameSite=Strict cookie; the DB holds only its HMAC.
 * Every request re-validates session, user status and device binding, so
 * disabling a user or disconnecting a device takes effect immediately.
 */
@Injectable()
export class SessionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly pins: PinService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  ttlMs(role: Role): number {
    const days = role === Role.WORKER ? this.config.sessionTtlDaysWorker : this.config.sessionTtlDaysStaff;
    return days * 86_400_000;
  }

  async create(
    tx: Prisma.TransactionClient,
    params: { userId: string; role: Role; deviceRowId: string; ip: string | null; userAgent: string | null },
  ): Promise<{ token: string; sessionId: string; expiresAt: Date }> {
    const token = randomToken();
    const expiresAt = new Date(Date.now() + this.ttlMs(params.role));
    const session = await tx.session.create({
      data: {
        userId: params.userId,
        deviceRowId: params.deviceRowId,
        tokenHash: this.pins.hashSessionToken(token),
        expiresAt,
        ip: params.ip,
        userAgent: params.userAgent?.slice(0, 300) ?? null,
      },
    });
    return { token, sessionId: session.id, expiresAt };
  }

  /** Returns the authenticated identity, or throws an Arabic-coded error. */
  async validate(token: string): Promise<{ user: AuthUser; expiresAt: Date; renewed: boolean }> {
    const session = await this.prisma.session.findUnique({
      where: { tokenHash: this.pins.hashSessionToken(token) },
      include: {
        user: { select: { id: true, role: true, name: true, isActive: true, deletedAt: true } },
        device: { select: { id: true, isActive: true } },
      },
    });
    const now = new Date();
    if (!session || session.revokedAt || session.expiresAt < now) throw new AppException('SESSION_EXPIRED');
    if (!session.user.isActive || session.user.deletedAt) throw new AppException('ACCOUNT_DISABLED');
    if (!session.device.isActive) throw new AppException('DEVICE_REVOKED');

    let expiresAt = session.expiresAt;
    let renewed = false;
    if (now.getTime() - session.lastUsedAt.getTime() > TOUCH_INTERVAL_MS) {
      expiresAt = new Date(now.getTime() + this.ttlMs(session.user.role));
      renewed = true;
      await this.prisma.$transaction([
        this.prisma.session.update({ where: { id: session.id }, data: { lastUsedAt: now, expiresAt } }),
        this.prisma.device.update({ where: { id: session.deviceRowId }, data: { lastSeenAt: now } }),
      ]);
    }

    return {
      user: {
        id: session.user.id,
        role: session.user.role,
        name: session.user.name,
        sessionId: session.id,
        deviceRowId: session.deviceRowId,
      },
      expiresAt,
      renewed,
    };
  }

  async revoke(sessionId: string): Promise<void> {
    await this.prisma.session.updateMany({ where: { id: sessionId, revokedAt: null }, data: { revokedAt: new Date() } });
  }

  async revokeAllForUser(userId: string, tx: Prisma.TransactionClient = this.prisma): Promise<void> {
    await tx.session.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() } });
  }
}
