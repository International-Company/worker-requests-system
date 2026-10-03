import { Injectable } from '@nestjs/common';
import { Prisma, RecipientStatus, RequestStatus, Role } from '@prisma/client';
import { AuditAction } from '../audit/audit-actions';
import { AuditService } from '../audit/audit.service';
import { AuthUser } from '../common/auth/auth-user';
import { AppException } from '../common/errors/app.exception';
import { EventsService } from '../events/events.service';
import { PresenceService } from '../presence/presence.service';
import { PrismaService } from '../prisma/prisma.service';
import { WorkerActionDto } from '../requests/dto/request.dto';
import { toWorkerView, workerRecipientInclude, WorkerRequestView } from '../requests/request-views';
import { decideTransition, WorkerAction } from './recipient-transitions';

/** History window delivered to a fresh device (active requests are always included). */
const HISTORY_LIMIT = 100;

/** Worker-side view of requests: list/sync, open, acknowledge, complete. */
@Injectable()
export class RequestRecipientsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly events: EventsService,
    private readonly presence: PresenceService,
  ) {}

  /**
   * Full sync (no `since`): all open requests + recent history.
   * Incremental sync (`since` = previous serverTime): everything changed after it,
   * including edits and cancellations. The client stores `serverTime` for next time.
   */
  async list(workerId: string, since?: string): Promise<{ items: WorkerRequestView[]; serverTime: string; full: boolean }> {
    const serverTime = new Date();
    void this.presence.touch(workerId);
    if (since) {
      // Small overlap protects against clock skew between DB rows committed around `since`.
      const from = new Date(new Date(since).getTime() - 5_000);
      const rows = await this.prisma.requestRecipient.findMany({
        where: { workerId, updatedAt: { gt: from } },
        include: workerRecipientInclude,
        orderBy: { createdAt: 'desc' },
        take: 500,
      });
      return { items: rows.map(toWorkerView), serverTime: serverTime.toISOString(), full: false };
    }
    const [open, history] = await Promise.all([
      this.prisma.requestRecipient.findMany({
        where: { workerId, status: { in: [RecipientStatus.NEW, RecipientStatus.ACKNOWLEDGED] } },
        include: workerRecipientInclude,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.requestRecipient.findMany({
        where: { workerId, status: { in: [RecipientStatus.COMPLETED, RecipientStatus.CANCELLED] } },
        include: workerRecipientInclude,
        orderBy: { createdAt: 'desc' },
        take: HISTORY_LIMIT,
      }),
    ]);
    return { items: [...open, ...history].map(toWorkerView), serverTime: serverTime.toISOString(), full: true };
  }

  async get(workerId: string, recipientId: string): Promise<WorkerRequestView> {
    const rc = await this.prisma.requestRecipient.findFirst({
      where: { id: recipientId, workerId },
      include: workerRecipientInclude,
    });
    if (!rc) throw new AppException('REQUEST_NOT_FOUND');
    return toWorkerView(rc);
  }

  /** First time the worker opens the request (server time). Stops reminder notifications. */
  async open(user: AuthUser, recipientId: string): Promise<WorkerRequestView> {
    const rc = await this.findOwn(user.id, recipientId);
    if (!rc.openedAt) {
      const { count } = await this.prisma.requestRecipient.updateMany({
        where: { id: rc.id, openedAt: null },
        data: { openedAt: new Date() },
      });
      if (count) {
        await this.audit.record({
          actorId: user.id,
          actorRole: Role.WORKER,
          action: AuditAction.REQUEST_OPENED,
          entityType: 'recipient',
          entityId: rc.id,
          metadata: { requestId: rc.requestId },
        });
        this.events.emit({ type: 'recipient.updated', managerId: rc.request.createdById, data: { requestId: rc.requestId } });
      }
    }
    return this.get(user.id, recipientId);
  }

  acknowledge(user: AuthUser, recipientId: string, dto: WorkerActionDto, ip: string | null) {
    return this.transition(user, recipientId, 'acknowledge', dto, ip);
  }

  complete(user: AuthUser, recipientId: string, dto: WorkerActionDto, ip: string | null) {
    return this.transition(user, recipientId, 'complete', dto, ip);
  }

  /**
   * Applies a worker action with optimistic concurrency on `stateVersion`.
   * Timestamps always come from the server clock; the client time is only logged.
   */
  private async transition(
    user: AuthUser,
    recipientId: string,
    action: WorkerAction,
    dto: WorkerActionDto,
    ip: string | null,
  ): Promise<{ applied: boolean; item: WorkerRequestView }> {
    // A lost compare-and-set means a concurrent change: re-read and decide again
    // (usually it becomes an idempotent no-op, e.g. a double tap).
    for (let attempt = 0; attempt < 3; attempt++) {
      const rc = await this.findOwn(user.id, recipientId);
      const effective = rc.request.status === RequestStatus.CANCELLED ? { ...rc, status: RecipientStatus.CANCELLED } : rc;
      const decision = decideTransition(action, effective, dto.baseStateVersion);

      if (decision.kind === 'reject') {
        throw new AppException(decision.code, { item: await this.get(user.id, recipientId) });
      }
      if (decision.kind === 'noop') return { applied: false, item: await this.get(user.id, recipientId) };

      const now = new Date();
      const data: Prisma.RequestRecipientUpdateManyMutationInput =
        action === 'acknowledge'
          ? { status: RecipientStatus.ACKNOWLEDGED, acknowledgedAt: now, openedAt: rc.openedAt ?? now, stateVersion: { increment: 1 } }
          : { status: RecipientStatus.COMPLETED, completedAt: now, stateVersion: { increment: 1 } };

      const won = await this.prisma.$transaction(async (tx) => {
        const { count } = await tx.requestRecipient.updateMany({
          where: { id: rc.id, stateVersion: rc.stateVersion, status: rc.status },
          data,
        });
        if (count === 0) return false;
        await this.audit.record(
          {
            actorId: user.id,
            actorRole: Role.WORKER,
            action: action === 'acknowledge' ? AuditAction.REQUEST_ACKNOWLEDGED : AuditAction.REQUEST_COMPLETED,
            entityType: 'recipient',
            entityId: rc.id,
            metadata: {
              requestId: rc.requestId,
              clientActionAt: dto.clientActionAt ?? null,
              opId: dto.opId ?? null,
              offlineReplay: dto.clientActionAt ? now.getTime() - new Date(dto.clientActionAt).getTime() > 30_000 : false,
            },
            ip,
          },
          tx,
        );
        return true;
      });
      if (!won) continue;

      void this.presence.touch(user.id);
      this.events.emit({ type: 'recipient.updated', managerId: rc.request.createdById, data: { requestId: rc.requestId } });
      return { applied: true, item: await this.get(user.id, recipientId) };
    }
    throw new AppException('STALE_STATE', { item: await this.get(user.id, recipientId) });
  }

  private async findOwn(workerId: string, recipientId: string) {
    const rc = await this.prisma.requestRecipient.findFirst({
      where: { id: recipientId, workerId },
      include: { request: { select: { createdById: true, status: true } } },
    });
    if (!rc) throw new AppException('REQUEST_NOT_FOUND');
    return rc;
  }
}
