import Dexie, { type EntityTable } from 'dexie';
import type { Role, TargetType, WorkerRequest } from '../lib/types';

/** Worker action recorded locally and replayed to the server (pending_acknowledge / pending_complete / open). */
export interface QueuedAction {
  id?: number;
  opId: string;
  userId: string;
  type: 'acknowledge' | 'complete' | 'open';
  recipientId: string;
  /** Recipient stateVersion the worker saw when acting — server rejects if the manager changed it since. */
  baseStateVersion?: number;
  clientActionAt: string;
  attempts: number;
  lastError?: string;
  createdAt: number;
}

/** Image waiting for upload as part of an outbox request (pending_upload). */
export interface OutboxImage {
  clientUploadId: string;
  blob: Blob;
  name: string;
  /** Set once uploaded; upload is idempotent per clientUploadId so retries are safe. */
  attachmentId?: string;
}

/** Manager request waiting to be sent (pending_request) — survives reloads and network loss. */
export interface OutboxRequest {
  idempotencyKey: string;
  userId: string;
  title: string;
  targetType: TargetType;
  workerIds: string[];
  images: OutboxImage[];
  status: 'pending' | 'sending' | 'failed';
  attempts: number;
  lastError?: string;
  /** Permanent errors (validation, permissions) are not retried automatically. */
  permanent?: boolean;
  createdAt: number;
}

/** Unsent "new request" form, autosaved. */
export interface Draft {
  id: string;
  userId: string;
  title: string;
  targetType: TargetType;
  workerIds: string[];
  images: Array<{ clientUploadId: string; blob: Blob; name: string }>;
  updatedAt: number;
}

export interface Notice {
  id?: number;
  userId: string;
  kind: 'conflict-cancelled' | 'conflict-stale' | 'failed';
  recipientId: string;
  title: string;
  createdAt: number;
}

export interface CachedUser {
  id: string;
  name: string;
  role: Role;
}

export class AppDB extends Dexie {
  requests!: EntityTable<WorkerRequest & { userId: string }, 'recipientId'>;
  queue!: EntityTable<QueuedAction, 'id'>;
  outbox!: EntityTable<OutboxRequest, 'idempotencyKey'>;
  drafts!: EntityTable<Draft, 'id'>;
  notices!: EntityTable<Notice, 'id'>;
  meta!: EntityTable<{ key: string; value: unknown }, 'key'>;

  constructor() {
    super('worker-requests');
    this.version(1).stores({
      requests: 'recipientId, userId, status, sentAt',
      queue: '++id, userId, recipientId, createdAt',
      outbox: 'idempotencyKey, userId, status, createdAt',
      drafts: 'id, userId',
      notices: '++id, userId, createdAt',
      meta: 'key',
    });
  }
}

export const db = new AppDB();

export async function getMeta<T>(key: string): Promise<T | undefined> {
  return (await db.meta.get(key))?.value as T | undefined;
}

export async function setMeta(key: string, value: unknown): Promise<void> {
  await db.meta.put({ key, value });
}

/** On logout / account switch: nothing of the previous user stays on the device. */
export async function clearUserData(): Promise<void> {
  await db.transaction('rw', [db.requests, db.queue, db.outbox, db.drafts, db.notices, db.meta], async () => {
    await Promise.all([db.requests.clear(), db.queue.clear(), db.outbox.clear(), db.drafts.clear(), db.notices.clear(), db.meta.clear()]);
  });
}
