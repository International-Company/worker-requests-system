import { Injectable } from '@nestjs/common';
import { NotificationType, Prisma, RecipientStatus, RequestStatus, Role, TargetType } from '@prisma/client';
import { AttachmentsService } from '../attachments/attachments.service';
import { AuditAction } from '../audit/audit-actions';
import { AuditService } from '../audit/audit.service';
import { AuthUser } from '../common/auth/auth-user';
import { AppException } from '../common/errors/app.exception';
import { EventsService } from '../events/events.service';
import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService } from '../prisma/prisma.service';
import { CreateRequestDto, ListRequestsQuery, ReopenRequestDto, UpdateRequestDto } from './dto/request.dto';
import { requestInclude, toRequestView } from './request-views';

type Actor = Pick<AuthUser, 'id' | 'role'>;
type Tx = Prisma.TransactionClient;

/** Manager-side request lifecycle: send, edit, cancel, resend, reopen, search. */
@Injectable()
export class RequestsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly attachments: AttachmentsService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
    private readonly events: EventsService,
  ) {}

  /**
   * Idempotent create: the same (manager, idempotencyKey) always maps to one request,
   * so double-clicks, network retries and offline replays can never create duplicates.
   */
  async create(dto: CreateRequestDto, actor: Actor, ip: string | null) {
    const replay = await this.findByIdempotencyKey(actor.id, dto.idempotencyKey, dto.title);
    if (replay) return { ...replay, replayed: true };

    let created: { id: string; recipientIds: string[] };
    try {
      created = await this.prisma.$transaction(async (tx) => {
        const workerIds = await this.resolveTargets(tx, dto.targetType, dto.workerIds ?? []);
        const attachmentIds = dto.attachmentIds ?? [];
        await this.attachments.assertLinkable(tx, attachmentIds, actor.id);

        const request = await tx.request.create({
          data: {
            title: dto.title,
            createdById: actor.id,
            targetType: dto.targetType,
            idempotencyKey: dto.idempotencyKey,
            recipients: { create: workerIds.map((workerId) => ({ workerId })) },
          },
          select: { id: true, number: true, recipients: { select: { id: true } } },
        });
        await this.attachments.link(tx, request.id, attachmentIds);
        await this.audit.record(
          {
            actorId: actor.id,
            actorRole: actor.role,
            action: AuditAction.REQUEST_CREATED,
            entityType: 'request',
            entityId: request.id,
            metadata: { number: request.number, title: dto.title, targetType: dto.targetType, workers: workerIds.length, images: attachmentIds.length },
            ip,
          },
          tx,
        );
        return { id: request.id, recipientIds: request.recipients.map((r) => r.id) };
      });
    } catch (e) {
      // Two concurrent submissions with the same key: the loser returns the winner's request.
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        const winner = await this.findByIdempotencyKey(actor.id, dto.idempotencyKey, dto.title);
        if (winner) return { ...winner, replayed: true };
      }
      throw e;
    }

    this.notifications.dispatchInBackground(created.recipientIds, NotificationType.NEW_REQUEST);
    this.events.emit({ type: 'request.created', managerId: actor.id, data: { requestId: created.id } });
    return { ...(await this.get(created.id, actor)), replayed: false };
  }

  async list(q: ListRequestsQuery, actor: Actor) {
    const where = this.buildWhere(q, actor);
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.request.findMany({
        where,
        include: requestInclude,
        orderBy: { createdAt: 'desc' },
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
      }),
      this.prisma.request.count({ where }),
    ]);
    return { items: rows.map(toRequestView), total, page: q.page, pageSize: q.pageSize };
  }

  async get(id: string, actor: Actor) {
    const r = await this.prisma.request.findUnique({ where: { id }, include: requestInclude });
    if (!r || !this.canView(r.createdById, actor)) throw new AppException('REQUEST_NOT_FOUND');
    return toRequestView(r);
  }

  /** Detailed timeline including every notification attempt per worker. */
  async getWithNotifications(id: string, actor: Actor) {
    const view = await this.get(id, actor);
    const notifications = await this.prisma.notification.findMany({
      where: { recipient: { requestId: id } },
      orderBy: { createdAt: 'asc' },
      select: { id: true, recipientId: true, type: true, status: true, error: true, attempts: true, sentAt: true, deliveredAt: true, createdAt: true },
    });
    return { ...view, notifications };
  }

  async update(id: string, dto: UpdateRequestDto, actor: Actor, ip: string | null) {
    const recipientIds = await this.prisma.$transaction(async (tx) => {
      const current = await this.lockOwned(tx, id, actor);
      if (current.status === RequestStatus.CANCELLED) throw new AppException('REQUEST_CANCELLED');

      const changes: Record<string, unknown> = {};
      if (dto.title !== undefined && dto.title !== current.title) changes.title = { from: current.title, to: dto.title };
      if (dto.attachmentIds !== undefined) {
        await this.attachments.assertLinkable(tx, dto.attachmentIds, actor.id, id);
        const before = await tx.requestAttachment.findMany({ where: { requestId: id }, select: { id: true } });
        // Detach everything, then re-link in the new order (positions are unique per request).
        // Images no longer referenced become orphans and are purged by the cleanup job.
        await tx.requestAttachment.updateMany({ where: { requestId: id }, data: { requestId: null } });
        await this.attachments.link(tx, id, dto.attachmentIds);
        changes.images = { from: before.length, to: dto.attachmentIds.length };
      }
      if (Object.keys(changes).length === 0) return [];

      const now = new Date();
      await tx.request.update({
        where: { id },
        data: { ...(dto.title !== undefined ? { title: dto.title } : {}), version: { increment: 1 }, editedAt: now },
      });
      // Bump recipients so the worker PWA picks the change up in its incremental sync.
      const affected = await tx.requestRecipient.findMany({
        where: { requestId: id, status: { in: [RecipientStatus.NEW, RecipientStatus.ACKNOWLEDGED] } },
        select: { id: true },
      });
      await tx.requestRecipient.updateMany({ where: { requestId: id }, data: { updatedAt: now } });
      await this.audit.record(
        {
          actorId: actor.id,
          actorRole: actor.role,
          action: AuditAction.REQUEST_UPDATED,
          entityType: 'request',
          entityId: id,
          metadata: changes as Prisma.InputJsonValue,
          ip,
        },
        tx,
      );
      return affected.map((r) => r.id);
    });

    this.notifications.dispatchInBackground(recipientIds, NotificationType.REQUEST_UPDATED);
    this.events.emit({ type: 'request.updated', managerId: actor.id, data: { requestId: id } });
    return this.get(id, actor);
  }

  /** Cancel = status change only; nothing is deleted. Completed recipients keep their state. */
  async cancel(id: string, actor: Actor, ip: string | null) {
    const recipientIds = await this.prisma.$transaction(async (tx) => {
      const current = await this.lockOwned(tx, id, actor);
      if (current.status === RequestStatus.CANCELLED) return [];
      const now = new Date();
      const open = await tx.requestRecipient.findMany({
        where: { requestId: id, status: { in: [RecipientStatus.NEW, RecipientStatus.ACKNOWLEDGED] } },
        select: { id: true },
      });
      await tx.request.update({ where: { id }, data: { status: RequestStatus.CANCELLED, cancelledAt: now } });
      await tx.requestRecipient.updateMany({
        where: { id: { in: open.map((r) => r.id) } },
        data: { status: RecipientStatus.CANCELLED, cancelledAt: now, stateVersion: { increment: 1 } },
      });
      await this.audit.record(
        {
          actorId: actor.id,
          actorRole: actor.role,
          action: AuditAction.REQUEST_CANCELLED,
          entityType: 'request',
          entityId: id,
          metadata: { cancelledRecipients: open.length },
          ip,
        },
        tx,
      );
      return open.map((r) => r.id);
    });

    this.notifications.dispatchInBackground(recipientIds, NotificationType.REQUEST_CANCELLED);
    this.events.emit({ type: 'request.cancelled', managerId: actor.id, data: { requestId: id } });
    return this.get(id, actor);
  }

  /** Resend = a brand-new request (same title, images and workers). The original is untouched. */
  async resend(id: string, idempotencyKey: string, actor: Actor, ip: string | null) {
    const source = await this.prisma.request.findUnique({
      where: { id },
      include: { recipients: { select: { workerId: true } } },
    });
    if (!source || source.createdById !== actor.id) throw new AppException('REQUEST_NOT_FOUND');

    const replay = await this.findByIdempotencyKey(actor.id, idempotencyKey, source.title);
    if (replay) return { ...replay, replayed: true };

    let created: { id: string; recipientIds: string[] };
    try {
      created = await this.prisma.$transaction(async (tx) => {
        const workerIds =
          source.targetType === TargetType.ALL
            ? await this.resolveTargets(tx, TargetType.ALL, [])
            : await this.activeWorkerIds(tx, source.recipients.map((r) => r.workerId));
        if (workerIds.length === 0) throw new AppException('NO_ACTIVE_RECIPIENTS');

        const request = await tx.request.create({
          data: {
            title: source.title,
            createdById: actor.id,
            targetType: source.targetType,
            idempotencyKey,
            resentFromId: source.id,
            recipients: { create: workerIds.map((workerId) => ({ workerId })) },
          },
          select: { id: true, number: true, recipients: { select: { id: true } } },
        });
        await this.attachments.copyToRequest(tx, source.id, request.id, actor.id);
        await this.audit.record(
          {
            actorId: actor.id,
            actorRole: actor.role,
            action: AuditAction.REQUEST_RESENT,
            entityType: 'request',
            entityId: request.id,
            metadata: { number: request.number, fromRequestId: source.id, fromNumber: source.number, workers: workerIds.length },
            ip,
          },
          tx,
        );
        return { id: request.id, recipientIds: request.recipients.map((r) => r.id) };
      });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        const winner = await this.findByIdempotencyKey(actor.id, idempotencyKey, source.title);
        if (winner) return { ...winner, replayed: true };
      }
      throw e;
    }

    this.notifications.dispatchInBackground(created.recipientIds, NotificationType.NEW_REQUEST);
    this.events.emit({ type: 'request.created', managerId: actor.id, data: { requestId: created.id } });
    return { ...(await this.get(created.id, actor)), replayed: false };
  }

  /**
   * Reopen: COMPLETED → ACKNOWLEDGED (the worker already received it and must finish it again).
   * stateVersion is bumped so stale offline actions from the worker are rejected.
   */
  async reopen(id: string, dto: ReopenRequestDto, actor: Actor, ip: string | null) {
    const recipientIds = await this.prisma.$transaction(async (tx) => {
      const current = await this.lockOwned(tx, id, actor);
      if (current.status === RequestStatus.CANCELLED) throw new AppException('REQUEST_CANCELLED');
      const targets = await tx.requestRecipient.findMany({
        where: {
          requestId: id,
          status: RecipientStatus.COMPLETED,
          ...(dto.recipientIds?.length ? { id: { in: dto.recipientIds } } : {}),
        },
        select: { id: true, workerId: true, completedAt: true },
      });
      if (targets.length === 0) throw new AppException('CANNOT_REOPEN');
      const now = new Date();
      await tx.requestRecipient.updateMany({
        where: { id: { in: targets.map((t) => t.id) }, status: RecipientStatus.COMPLETED },
        data: { status: RecipientStatus.ACKNOWLEDGED, completedAt: null, reopenedAt: now, stateVersion: { increment: 1 } },
      });
      await this.audit.record(
        {
          actorId: actor.id,
          actorRole: actor.role,
          action: AuditAction.REQUEST_REOPENED,
          entityType: 'request',
          entityId: id,
          // Previous completion times are preserved in the audit trail.
          metadata: { recipients: targets.map((t) => ({ recipientId: t.id, workerId: t.workerId, previousCompletedAt: t.completedAt?.toISOString() ?? null })) },
          ip,
        },
        tx,
      );
      return targets.map((t) => t.id);
    });

    this.notifications.dispatchInBackground(recipientIds, NotificationType.REQUEST_REOPENED);
    this.events.emit({ type: 'recipient.updated', managerId: actor.id, data: { requestId: id } });
    return this.get(id, actor);
  }

  // ---------------------------------------------------------------- helpers

  private canView(createdById: string, actor: Actor): boolean {
    return actor.role === Role.SYSTEM_ADMIN || createdById === actor.id;
  }

  /** Row-locks the request (serialises concurrent edits/cancels) and checks ownership. */
  private async lockOwned(tx: Tx, id: string, actor: Actor) {
    await tx.$queryRaw`SELECT id FROM requests WHERE id = ${id}::uuid FOR UPDATE`;
    const current = await tx.request.findUnique({ where: { id } });
    if (!current || current.createdById !== actor.id) throw new AppException('REQUEST_NOT_FOUND');
    return current;
  }

  private async findByIdempotencyKey(managerId: string, key: string, title: string) {
    const existing = await this.prisma.request.findUnique({
      where: { createdById_idempotencyKey: { createdById: managerId, idempotencyKey: key } },
      include: requestInclude,
    });
    if (!existing) return null;
    if (existing.title !== title) throw new AppException('IDEMPOTENCY_CONFLICT');
    return toRequestView(existing);
  }

  private async resolveTargets(tx: Tx, targetType: TargetType, workerIds: string[]): Promise<string[]> {
    if (targetType === TargetType.ALL) {
      const all = await tx.user.findMany({
        where: { role: Role.WORKER, isActive: true, deletedAt: null },
        select: { id: true },
      });
      if (all.length === 0) throw new AppException('NO_ACTIVE_RECIPIENTS');
      return all.map((w) => w.id);
    }
    const unique = [...new Set(workerIds)];
    if (unique.length === 0 || (targetType === TargetType.SINGLE && unique.length !== 1)) {
      throw new AppException('INVALID_RECIPIENTS');
    }
    const active = await this.activeWorkerIds(tx, unique);
    if (active.length !== unique.length) throw new AppException('INVALID_RECIPIENTS');
    return active;
  }

  private async activeWorkerIds(tx: Tx, ids: string[]): Promise<string[]> {
    const rows = await tx.user.findMany({
      where: { id: { in: ids }, role: Role.WORKER, isActive: true, deletedAt: null },
      select: { id: true },
    });
    return rows.map((r) => r.id);
  }

  private buildWhere(q: ListRequestsQuery, actor: Actor): Prisma.RequestWhereInput {
    const and: Prisma.RequestWhereInput[] = [];
    if (actor.role === Role.SYSTEM_ADMIN) {
      if (q.managerId) and.push({ createdById: q.managerId });
    } else {
      and.push({ createdById: actor.id }); // managers never see other managers' requests
    }
    if (q.q) {
      const text = q.q.trim().replace(/^#/, '');
      const asNumber = /^\d{1,9}$/.test(text) ? Number(text) : null;
      and.push({
        OR: [{ title: { contains: text, mode: 'insensitive' } }, ...(asNumber !== null ? [{ number: asNumber }] : [])],
      });
    }
    if (q.from) and.push({ createdAt: { gte: new Date(q.from) } });
    if (q.to) {
      const to = new Date(q.to);
      // A bare date ("2026-10-03") means the whole day.
      if (/^\d{4}-\d{2}-\d{2}$/.test(q.to)) to.setUTCHours(23, 59, 59, 999);
      and.push({ createdAt: { lte: to } });
    }
    if (q.workerId || q.status) {
      and.push({
        recipients: {
          some: { ...(q.workerId ? { workerId: q.workerId } : {}), ...(q.status ? { status: q.status } : {}) },
        },
      });
    }
    if (q.view === 'active') {
      and.push({
        status: RequestStatus.ACTIVE,
        recipients: { some: { status: { in: [RecipientStatus.NEW, RecipientStatus.ACKNOWLEDGED] } } },
      });
    }
    return and.length ? { AND: and } : {};
  }
}
