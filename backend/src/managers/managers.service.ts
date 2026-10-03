import { Injectable } from '@nestjs/common';
import { Prisma, Role } from '@prisma/client';
import { AuditAction } from '../audit/audit-actions';
import { AuditService } from '../audit/audit.service';
import { AppException } from '../common/errors/app.exception';
import { DevicesService } from '../devices/devices.service';
import { PrismaService } from '../prisma/prisma.service';
import { UsersService } from '../users/users.service';
import { CreateManagerDto, UpdateManagerDto } from './dto/manager.dto';

type Actor = { id: string; role: Role };
const STAFF = [Role.MANAGER, Role.SYSTEM_ADMIN];

/** Dashboard accounts (managers and system admins). Managed by system admins only. */
@Injectable()
export class ManagersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly users: UsersService,
    private readonly audit: AuditService,
    private readonly devices: DevicesService,
  ) {}

  async list() {
    const rows = await this.prisma.user.findMany({
      where: { role: { in: STAFF }, deletedAt: null },
      orderBy: [{ isActive: 'desc' }, { role: 'asc' }, { name: 'asc' }],
      select: {
        id: true,
        name: true,
        role: true,
        isActive: true,
        lastLoginAt: true,
        createdAt: true,
        sessions: {
          where: { revokedAt: null, expiresAt: { gt: new Date() } },
          select: { lastUsedAt: true },
          orderBy: { lastUsedAt: 'desc' },
        },
      },
    });
    return rows.map(({ sessions, ...r }) => ({
      ...r,
      activeSessions: sessions.length,
      lastActivityAt: sessions[0]?.lastUsedAt ?? null,
    }));
  }

  async get(id: string) {
    const row = (await this.list()).find((m) => m.id === id);
    if (!row) throw new AppException('MANAGER_NOT_FOUND');
    return row;
  }

  async create(dto: CreateManagerDto, actor: Actor, ip: string | null) {
    try {
      const id = await this.prisma.$transaction(async (tx) => {
        const pinHash = await this.users.assertPinAvailable(dto.pin, undefined, tx);
        const user = await tx.user.create({
          data: { role: dto.role ?? Role.MANAGER, name: dto.name, pinHash, isActive: dto.isActive ?? true },
        });
        await this.audit.record(
          {
            actorId: actor.id,
            actorRole: actor.role,
            action: AuditAction.STAFF_CREATED,
            entityType: 'staff',
            entityId: user.id,
            metadata: { name: user.name, role: user.role, isActive: user.isActive },
            ip,
          },
          tx,
        );
        return user.id;
      });
      return this.get(id);
    } catch (e) {
      UsersService.rethrowPinConflict(e);
    }
  }

  async update(id: string, dto: UpdateManagerDto, actor: Actor, ip: string | null) {
    const current = await this.findStaff(id);
    const deactivating = dto.isActive === false && current.isActive;
    const demoting = dto.role !== undefined && dto.role !== Role.SYSTEM_ADMIN && current.role === Role.SYSTEM_ADMIN;

    if (id === actor.id && (deactivating || demoting)) throw new AppException('CANNOT_MODIFY_SELF');
    if ((deactivating || demoting) && current.role === Role.SYSTEM_ADMIN) await this.assertNotLastAdmin(id);

    await this.prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id },
        data: {
          ...(dto.name !== undefined ? { name: dto.name } : {}),
          ...(dto.role !== undefined ? { role: dto.role } : {}),
          ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
        },
      });
      // Role change or deactivation: force re-login so permissions are re-evaluated.
      if (deactivating || (dto.role !== undefined && dto.role !== current.role)) {
        await this.devices.revokeAllForUser(tx, id, 'USER_DISABLED');
      }
      const statusChanged = dto.isActive !== undefined && dto.isActive !== current.isActive;
      await this.audit.record(
        {
          actorId: actor.id,
          actorRole: actor.role,
          action: statusChanged
            ? dto.isActive
              ? AuditAction.STAFF_ACTIVATED
              : AuditAction.STAFF_DEACTIVATED
            : AuditAction.STAFF_UPDATED,
          entityType: 'staff',
          entityId: id,
          metadata: { name: dto.name, role: dto.role, isActive: dto.isActive, previousRole: current.role } as Prisma.InputJsonValue,
          ip,
        },
        tx,
      );
    });
    return this.get(id);
  }

  async changePin(id: string, pin: string, actor: Actor, ip: string | null): Promise<void> {
    await this.findStaff(id);
    try {
      await this.prisma.$transaction(async (tx) => {
        const pinHash = await this.users.assertPinAvailable(pin, id, tx);
        await tx.user.update({ where: { id }, data: { pinHash } });
        await this.audit.record(
          { actorId: actor.id, actorRole: actor.role, action: AuditAction.STAFF_PIN_CHANGED, entityType: 'staff', entityId: id, ip },
          tx,
        );
      });
    } catch (e) {
      UsersService.rethrowPinConflict(e);
    }
  }

  /** Soft delete. Requests created by this manager stay intact. */
  async remove(id: string, actor: Actor, ip: string | null): Promise<void> {
    const current = await this.findStaff(id);
    if (id === actor.id) throw new AppException('CANNOT_MODIFY_SELF');
    if (current.role === Role.SYSTEM_ADMIN) await this.assertNotLastAdmin(id);
    await this.prisma.$transaction(async (tx) => {
      await this.devices.revokeAllForUser(tx, id, 'USER_DISABLED');
      await tx.user.update({ where: { id }, data: { deletedAt: new Date(), isActive: false, pinHash: null } });
      await this.audit.record(
        { actorId: actor.id, actorRole: actor.role, action: AuditAction.STAFF_DELETED, entityType: 'staff', entityId: id, metadata: { name: current.name }, ip },
        tx,
      );
    });
  }

  private async findStaff(id: string) {
    const user = await this.prisma.user.findFirst({ where: { id, role: { in: STAFF }, deletedAt: null } });
    if (!user) throw new AppException('MANAGER_NOT_FOUND');
    return user;
  }

  private async assertNotLastAdmin(excludingId: string) {
    const others = await this.prisma.user.count({
      where: { role: Role.SYSTEM_ADMIN, isActive: true, deletedAt: null, NOT: { id: excludingId } },
    });
    if (others === 0) throw new AppException('LAST_ADMIN');
  }
}
