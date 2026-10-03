import { Prisma } from '@prisma/client';
import { attachmentMetaSelect } from '../attachments/attachments.service';

export const recipientSelect = {
  id: true,
  workerId: true,
  status: true,
  stateVersion: true,
  deliveredAt: true,
  openedAt: true,
  acknowledgedAt: true,
  completedAt: true,
  cancelledAt: true,
  reopenedAt: true,
  lastNotifiedAt: true,
  reminderCount: true,
  createdAt: true,
  updatedAt: true,
  worker: { select: { name: true } },
} satisfies Prisma.RequestRecipientSelect;

export const requestInclude = {
  createdBy: { select: { id: true, name: true } },
  attachments: { select: attachmentMetaSelect, orderBy: { position: 'asc' } },
  recipients: { select: recipientSelect, orderBy: { worker: { name: 'asc' } } },
} satisfies Prisma.RequestInclude;

export type RequestWithRelations = Prisma.RequestGetPayload<{ include: typeof requestInclude }>;

export function toRequestView(r: RequestWithRelations) {
  const counts = { NEW: 0, ACKNOWLEDGED: 0, COMPLETED: 0, CANCELLED: 0 };
  for (const rc of r.recipients) counts[rc.status]++;
  return {
    id: r.id,
    number: r.number,
    title: r.title,
    status: r.status,
    targetType: r.targetType,
    version: r.version,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
    editedAt: r.editedAt,
    cancelledAt: r.cancelledAt,
    resentFromId: r.resentFromId,
    createdBy: r.createdBy,
    attachments: r.attachments,
    counts,
    recipients: r.recipients.map(({ worker, ...rc }) => ({ ...rc, workerName: worker.name })),
  };
}

/** What the worker PWA receives / caches for one request addressed to them. */
export const workerRecipientInclude = {
  request: {
    select: {
      id: true,
      number: true,
      title: true,
      status: true,
      version: true,
      createdAt: true,
      editedAt: true,
      createdBy: { select: { name: true } },
      attachments: { select: { id: true, width: true, height: true, position: true }, orderBy: { position: 'asc' } },
    },
  },
} satisfies Prisma.RequestRecipientInclude;

export type WorkerRecipientRow = Prisma.RequestRecipientGetPayload<{ include: typeof workerRecipientInclude }>;

export function toWorkerView(rc: WorkerRecipientRow) {
  return {
    recipientId: rc.id,
    requestId: rc.request.id,
    number: rc.request.number,
    title: rc.request.title,
    managerName: rc.request.createdBy.name,
    requestStatus: rc.request.status,
    requestVersion: rc.request.version,
    status: rc.status,
    stateVersion: rc.stateVersion,
    sentAt: rc.request.createdAt,
    editedAt: rc.request.editedAt,
    deliveredAt: rc.deliveredAt,
    openedAt: rc.openedAt,
    acknowledgedAt: rc.acknowledgedAt,
    completedAt: rc.completedAt,
    cancelledAt: rc.cancelledAt,
    reopenedAt: rc.reopenedAt,
    updatedAt: rc.updatedAt,
    attachments: rc.request.attachments,
  };
}

export type WorkerRequestView = ReturnType<typeof toWorkerView>;
