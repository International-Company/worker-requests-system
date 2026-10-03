import { Injectable, Logger } from '@nestjs/common';
import { Prisma, Role } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditActionType } from './audit-actions';

export interface AuditEntry {
  actorId: string | null;
  actorRole: Role | null;
  action: AuditActionType;
  entityType: 'worker' | 'staff' | 'device' | 'request' | 'recipient' | 'settings';
  entityId?: string | null;
  metadata?: Prisma.InputJsonValue;
  ip?: string | null;
}

type Tx = Prisma.TransactionClient | PrismaService;

/** Append-only audit trail. There is intentionally no update/delete API. */
@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(private readonly prisma: PrismaService) {}

  async record(entry: AuditEntry, tx: Tx = this.prisma): Promise<void> {
    try {
      await tx.auditLog.create({
        data: {
          actorId: entry.actorId,
          actorRole: entry.actorRole,
          action: entry.action,
          entityType: entry.entityType,
          entityId: entry.entityId ?? null,
          metadata: entry.metadata,
          ip: entry.ip ?? null,
        },
      });
    } catch (e) {
      // Inside a transaction the error must propagate so the whole operation rolls back.
      if (tx !== this.prisma) throw e;
      this.logger.error(`Failed to write audit log ${entry.action}`, (e as Error).stack);
    }
  }

  async list(params: { page: number; pageSize: number; action?: string; entityType?: string }) {
    const where: Prisma.AuditLogWhereInput = {
      ...(params.action ? { action: params.action } : {}),
      ...(params.entityType ? { entityType: params.entityType } : {}),
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.auditLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (params.page - 1) * params.pageSize,
        take: params.pageSize,
        include: { actor: { select: { id: true, name: true, role: true } } },
      }),
      this.prisma.auditLog.count({ where }),
    ]);
    return { items, total, page: params.page, pageSize: params.pageSize };
  }

  async listLogins(params: { page: number; pageSize: number; role?: Role }) {
    const where: Prisma.LoginLogWhereInput = params.role ? { role: params.role } : {};
    const [items, total] = await this.prisma.$transaction([
      this.prisma.loginLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (params.page - 1) * params.pageSize,
        take: params.pageSize,
        include: {
          user: { select: { id: true, name: true } },
          session: { select: { lastUsedAt: true, revokedAt: true, expiresAt: true } },
        },
      }),
      this.prisma.loginLog.count({ where }),
    ]);
    return { items, total, page: params.page, pageSize: params.pageSize };
  }
}
