import { api, ApiError } from '../lib/api';
import type { RequestView, TargetType } from '../lib/types';
import { db, type OutboxImage, type OutboxRequest } from './db';

/**
 * Manager outbox (pending_request + pending_upload)
 * -----------------------------------------------
 * "إرسال" never sends directly: the request (with its already-compressed images) is first
 * written to IndexedDB, then delivered:
 *   1. each image is uploaded with its clientUploadId (idempotent → retries never duplicate)
 *   2. the request is created with its idempotencyKey (idempotent → double-click/retry safe)
 * If the network drops at any point the entry stays in the outbox and is retried
 * automatically (online event, app start, timer, Background Sync). Nothing is lost.
 */

let running: Promise<void> | null = null;

export async function enqueueRequest(input: {
  userId: string;
  idempotencyKey: string;
  title: string;
  targetType: TargetType;
  workerIds: string[];
  images: Array<Omit<OutboxImage, 'attachmentId'>>;
}): Promise<OutboxRequest> {
  const entry: OutboxRequest = { ...input, status: 'pending', attempts: 0, createdAt: Date.now() };
  await db.outbox.put(entry);
  return entry;
}

export type SendOutcome =
  | { kind: 'sent'; request: RequestView }
  | { kind: 'queued'; reason: 'offline' | 'server' }
  | { kind: 'failed'; message: string };

/** Tries to deliver one outbox entry now. */
export async function sendOne(idempotencyKey: string): Promise<SendOutcome> {
  const entry = await db.outbox.get(idempotencyKey);
  if (!entry) return { kind: 'failed', message: '' };
  await db.outbox.update(idempotencyKey, { status: 'sending' });
  try {
    const attachmentIds: string[] = [];
    for (const img of entry.images) {
      if (!img.attachmentId) {
        const form = new FormData();
        form.append('clientUploadId', img.clientUploadId);
        form.append('file', img.blob, img.name);
        const uploaded = await api<{ id: string }>('/attachments', { method: 'POST', body: form });
        img.attachmentId = uploaded.id;
        await db.outbox.update(idempotencyKey, { images: entry.images }); // remember progress
      }
      attachmentIds.push(img.attachmentId);
    }
    const request = await api<RequestView>('/requests', {
      method: 'POST',
      body: {
        idempotencyKey: entry.idempotencyKey,
        title: entry.title,
        targetType: entry.targetType,
        workerIds: entry.targetType === 'ALL' ? undefined : entry.workerIds,
        attachmentIds,
      },
    });
    await db.outbox.delete(idempotencyKey);
    return { kind: 'sent', request };
  } catch (e) {
    const err = e instanceof ApiError ? e : new ApiError(0, 'NETWORK', '');
    const transient = err.isNetwork || err.status >= 500 || err.status === 429 || err.isAuth;
    await db.outbox.update(idempotencyKey, {
      status: transient ? 'pending' : 'failed',
      attempts: entry.attempts + 1,
      lastError: err.message,
      permanent: !transient,
    });
    if (transient) return { kind: 'queued', reason: err.isNetwork ? 'offline' : 'server' };
    return { kind: 'failed', message: err.message };
  }
}

/** Retries every pending (non-permanent) entry of this manager, oldest first. Single flight. */
export function flushOutbox(userId: string): Promise<void> {
  running ??= (async () => {
    const entries = await db.outbox.where('userId').equals(userId).sortBy('createdAt');
    for (const entry of entries) {
      if (entry.permanent) continue;
      const outcome = await sendOne(entry.idempotencyKey);
      if (outcome.kind === 'queued' && outcome.reason === 'offline') break;
    }
  })().finally(() => {
    running = null;
  });
  return running;
}

export async function discardOutbox(idempotencyKey: string): Promise<void> {
  await db.outbox.delete(idempotencyKey);
}
