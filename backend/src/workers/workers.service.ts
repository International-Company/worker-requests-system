import { Injectable } from '@nestjs/common';
import { Prisma, Role } from '@prisma/client';
import { ImageProcessorService } from '../attachments/image-processor.service';
import { AuditAction } from '../audit/audit-actions';
import { AuditService } from '../audit/audit.service';
import { AppException } from '../common/errors/app.exception';
import { DevicesService } from '../devices/devices.service';
import { EventsService } from '../events/events.service';
import { PresenceService } from '../presence/presence.service';
import { PrismaService } from '../prisma/prisma.service';
import { SettingsService } from '../settings/settings.service';
import { UsersService } from '../users/users.service';
import { CreateWorkerDto, UpdateWorkerDto } from './dto/worker.dto';

type Actor = { id: string; role: Role };

const workerSelect = {
  id: true,
  name: true,
  isActive: true,
  lastLoginAt: true,
  createdAt: true,
  worker: { select: { phone: true, photoEtag: true } },
  presence: { select: { lastSeenAt: true, visible: true } },
  devices: {
    where: { isActive: true },
    select: {
      id: true,
      label: true,
      boundAt: true,
      lastSeenAt: true,
      pushSubscriptions: { where: { isActive: true }, select: { id: true }, take: 1 },
    },
    take: 1,
  },
} satisfies Prisma.UserSelect;

type WorkerRow = Prisma.UserGetPayload<{ select: typeof workerSelect }>;

export type WorkerView = ReturnType<WorkersService['toView']>;

@Injectable()
export class WorkersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly users: UsersService,
    private readonly audit: AuditService,
    private readonly devices: DevicesService,
    private readonly presence: PresenceService,
    private readonly settings: SettingsService,
    private readonly images: ImageProcessorService,
    private readonly events: EventsService,
  ) {}

  async list(params: { includeInactive: boolean; q?: string }) {
    const rows = await this.prisma.user.findMany({
      where: {
        role: Role.WORKER,
        deletedAt: null,
        ...(params.includeInactive ? {} : { isActive: true }),
        ...(params.q ? { name: { contains: params.q, mode: 'insensitive' } } : {}),
      },
      select: workerSelect,
      orderBy: [{ isActive: 'desc' }, { name: 'asc' }],
    });
    const threshold = await this.settings.get('presence.onlineThresholdSeconds');
    return rows.map((r) => this.toView(r, threshold));
  }

  async get(id: string) {
    const row = await this.prisma.user.findFirst({ where: { id, role: Role.WORKER, deletedAt: null }, select: workerSelect });
    if (!row) throw new AppException('WORKER_NOT_FOUND');
    return this.toView(row, await this.settings.get('presence.onlineThresholdSeconds'));
  }

  async create(dto: CreateWorkerDto, actor: Actor, ip: string | null) {
    try {
      const id = await this.prisma.$transaction(async (tx) => {
        const pinHash = await this.users.assertPinAvailable(dto.pin, undefined, tx);
        const user = await tx.user.create({
          data: {
            role: Role.WORKER,
            name: dto.name,
            pinHash,
            isActive: dto.isActive ?? true,
            worker: { create: { phone: dto.phone } },
          },
        });
        await this.audit.record(
          {
            actorId: actor.id,
            actorRole: actor.role,
            action: AuditAction.WORKER_CREATED,
            entityType: 'worker',
            entityId: user.id,
            metadata: { name: dto.name, phone: dto.phone, isActive: user.isActive },
            ip,
          },
          tx,
        );
        return user.id;
      });
      this.events.emit({ type: 'worker.updated', managerId: null, data: { workerId: id } });
      return this.get(id);
    } catch (e) {
      UsersService.rethrowPinConflict(e);
    }
  }

  async update(id: string, dto: UpdateWorkerDto, actor: Actor, ip: string | null) {
    const current = await this.prisma.user.findFirst({ where: { id, role: Role.WORKER, deletedAt: null } });
    if (!current) throw new AppException('WORKER_NOT_FOUND');

    await this.prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id },
        data: {
          ...(dto.name !== undefined ? { name: dto.name } : {}),
          ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
          ...(dto.phone !== undefined ? { worker: { update: { phone: dto.phone } } } : {}),
        },
      });
      const statusChanged = dto.isActive !== undefined && dto.isActive !== current.isActive;
      if (statusChanged && dto.isActive === false) {
        // Disabled worker: cannot log in, gets no new requests, browser unbound. History is kept.
        await this.devices.revokeAllForUser(tx, id, 'USER_DISABLED');
      }
      const action = statusChanged
        ? dto.isActive
          ? AuditAction.WORKER_ACTIVATED
          : AuditAction.WORKER_DEACTIVATED
        : AuditAction.WORKER_UPDATED;
      await this.audit.record(
        {
          actorId: actor.id,
          actorRole: actor.role,
          action,
          entityType: 'worker',
          entityId: id,
          metadata: { name: dto.name, phone: dto.phone, isActive: dto.isActive } as Prisma.InputJsonValue,
          ip,
        },
        tx,
      );
    });
    this.events.emit({ type: 'worker.updated', managerId: null, data: { workerId: id } });
    return this.get(id);
  }

  async changePin(id: string, pin: string, actor: Actor, ip: string | null): Promise<void> {
    const current = await this.prisma.user.findFirst({ where: { id, role: Role.WORKER, deletedAt: null } });
    if (!current) throw new AppException('WORKER_NOT_FOUND');
    try {
      await this.prisma.$transaction(async (tx) => {
        const pinHash = await this.users.assertPinAvailable(pin, id, tx);
        await tx.user.update({ where: { id }, data: { pinHash } });
        // The PIN itself is never written to the audit log.
        await this.audit.record(
          { actorId: actor.id, actorRole: actor.role, action: AuditAction.WORKER_PIN_CHANGED, entityType: 'worker', entityId: id, ip },
          tx,
        );
      });
    } catch (e) {
      UsersService.rethrowPinConflict(e);
    }
  }

  /** Soft delete (system admin only): hidden from lists, PIN released, all history preserved. */
  async remove(id: string, actor: Actor, ip: string | null): Promise<void> {
    const current = await this.prisma.user.findFirst({ where: { id, role: Role.WORKER, deletedAt: null } });
    if (!current) throw new AppException('WORKER_NOT_FOUND');
    await this.prisma.$transaction(async (tx) => {
      await this.devices.revokeAllForUser(tx, id, 'USER_DISABLED');
      await tx.user.update({ where: { id }, data: { deletedAt: new Date(), isActive: false, pinHash: null } });
      await this.audit.record(
        {
          actorId: actor.id,
          actorRole: actor.role,
          action: AuditAction.WORKER_DELETED,
          entityType: 'worker',
          entityId: id,
          metadata: { name: current.name },
          ip,
        },
        tx,
      );
    });
    this.events.emit({ type: 'worker.updated', managerId: null, data: { workerId: id } });
  }

  async setPhoto(id: string, file: Buffer, actor: Actor, ip: string | null) {
    const current = await this.prisma.user.findFirst({ where: { id, role: Role.WORKER, deletedAt: null } });
    if (!current) throw new AppException('WORKER_NOT_FOUND');
    const img = await this.images.process(file, { maxDimension: 512, quality: 80 });
    await this.prisma.$transaction(async (tx) => {
      await tx.workerProfile.update({
        where: { userId: id },
        data: { photo: img.data, photoMime: img.mimeType, photoEtag: img.sha256.slice(0, 32) },
      });
      await this.audit.record(
        { actorId: actor.id, actorRole: actor.role, action: AuditAction.WORKER_PHOTO_CHANGED, entityType: 'worker', entityId: id, ip },
        tx,
      );
    });
    return this.get(id);
  }

  async getPhoto(id: string) {
    const profile = await this.prisma.workerProfile.findUnique({
      where: { userId: id },
      select: { photo: true, photoMime: true, photoEtag: true },
    });
    if (!profile?.photo || !profile.photoMime) throw new AppException('NOT_FOUND');
    return { data: Buffer.from(profile.photo), mime: profile.photoMime, etag: profile.photoEtag ?? '' };
  }

  toView(r: WorkerRow, thresholdSeconds: number) {
    const device = r.devices[0] ?? null;
    const lastSeenAt = r.presence?.lastSeenAt ?? null;
    return {
      id: r.id,
      name: r.name,
      phone: r.worker?.phone ?? '',
      isActive: r.isActive,
      photoVersion: r.worker?.photoEtag ?? null,
      lastLoginAt: r.lastLoginAt,
      createdAt: r.createdAt,
      isOnline: r.isActive && device !== null && this.presence.isOnline(lastSeenAt, thresholdSeconds),
      lastSeenAt,
      device: device
        ? {
            label: device.label,
            boundAt: device.boundAt,
            lastSeenAt: device.lastSeenAt,
            pushEnabled: device.pushSubscriptions.length > 0,
          }
        : null,
    };
  }
}
