import { Injectable } from '@nestjs/common';
import { Prisma, RecipientStatus, Role } from '@prisma/client';
import { AuthUser } from '../common/auth/auth-user';
import { PrismaService } from '../prisma/prisma.service';
import { SettingsService } from '../settings/settings.service';

@Injectable()
export class DashboardService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
  ) {}

  /**
   * Counts are per worker (recipient), matching how the manager tracks work:
   * new / in progress are "right now", completed / cancelled are "today".
   * Managers see only their own requests; system admins see everything.
   */
  async stats(user: Pick<AuthUser, 'id' | 'role'>) {
    const scope: Prisma.RequestRecipientWhereInput =
      user.role === Role.SYSTEM_ADMIN ? {} : { request: { createdById: user.id } };
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0); // server-local day — set TZ (e.g. Asia/Riyadh) on the server
    const threshold = await this.settings.get('presence.onlineThresholdSeconds');
    const onlineSince = new Date(Date.now() - threshold * 1000);

    const [newCount, inProgress, completedToday, cancelledToday, onlineWorkers, activeWorkers] = await Promise.all([
      this.prisma.requestRecipient.count({ where: { ...scope, status: RecipientStatus.NEW } }),
      this.prisma.requestRecipient.count({ where: { ...scope, status: RecipientStatus.ACKNOWLEDGED } }),
      this.prisma.requestRecipient.count({ where: { ...scope, status: RecipientStatus.COMPLETED, completedAt: { gte: startOfDay } } }),
      this.prisma.requestRecipient.count({ where: { ...scope, status: RecipientStatus.CANCELLED, cancelledAt: { gte: startOfDay } } }),
      this.prisma.user.count({
        where: {
          role: Role.WORKER,
          isActive: true,
          deletedAt: null,
          presence: { lastSeenAt: { gte: onlineSince } },
          devices: { some: { isActive: true } },
        },
      }),
      this.prisma.user.count({ where: { role: Role.WORKER, isActive: true, deletedAt: null } }),
    ]);

    return {
      onlineWorkers,
      activeWorkers,
      newRequests: newCount,
      inProgress,
      completedToday,
      cancelledToday,
      serverTime: new Date().toISOString(),
    };
  }
}
