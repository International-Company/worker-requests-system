import { api, ApiError } from '../lib/api';
import { uuid } from '../lib/device';
import type { WorkerRequest } from '../lib/types';
import { db, getMeta, setMeta, type QueuedAction } from './db';

/**
 * Worker offline model
 * --------------------
 * • Requests are cached in IndexedDB; the UI always renders from the cache (works offline).
 * • Actions (open / acknowledge / complete) are applied optimistically to the cache and
 *   appended to a FIFO queue, then replayed to the server in order.
 * • Each action carries the recipient `stateVersion` seen by the worker. The server rejects
 *   stale actions (manager cancelled / reopened meanwhile) with 409 + its current state;
 *   we then drop the action, store the server state and show a notice. Replays of an
 *   already-applied action are idempotent no-ops on the server.
 * • Network/5xx failures keep the action queued for the next attempt.
 * • Timestamps are always decided by the server; the local time is only informational.
 *
 * This module has no DOM dependency, so the service worker uses it for Background Sync.
 */

const LAST_SYNC = 'worker.lastSync';
let processing: Promise<SyncResult> | null = null;

export interface SyncResult {
  sent: number;
  dropped: number;
  remaining: number;
  offline: boolean;
  authFailed: boolean;
}

type Change = Pick<WorkerRequest, 'status' | 'stateVersion' | 'openedAt' | 'acknowledgedAt' | 'completedAt'>;

/** Pure optimistic transition used for the local cache (mirrors the server state machine). */
export function applyLocally(item: WorkerRequest, type: QueuedAction['type'], at: string): WorkerRequest | null {
  if (item.status === 'CANCELLED' || item.requestStatus === 'CANCELLED') return null;
  const next: Partial<Change> = {};
  if (type === 'open') {
    if (item.openedAt) return null;
    next.openedAt = at;
  } else if (type === 'acknowledge') {
    if (item.status !== 'NEW') return null;
    Object.assign(next, { status: 'ACKNOWLEDGED', acknowledgedAt: at, openedAt: item.openedAt ?? at, stateVersion: item.stateVersion + 1 });
  } else {
    if (item.status !== 'ACKNOWLEDGED') return null;
    Object.assign(next, { status: 'COMPLETED', completedAt: at, stateVersion: item.stateVersion + 1 });
  }
  return { ...item, ...next };
}

/** Records a worker action: optimistic local update + queued for the server. */
export async function recordAction(userId: string, recipientId: string, type: QueuedAction['type']): Promise<WorkerRequest | null> {
  const now = new Date().toISOString();
  return db.transaction('rw', db.requests, db.queue, async () => {
    const item = await db.requests.get(recipientId);
    if (!item) return null;
    const updated = applyLocally(item, type, now);
    if (!updated) return item; // nothing to do (double tap, already done)
    await db.requests.put({ ...updated, userId });
    await db.queue.add({
      opId: uuid(),
      userId,
      type,
      recipientId,
      baseStateVersion: type === 'open' ? undefined : item.stateVersion,
      clientActionAt: now,
      attempts: 0,
      createdAt: Date.now(),
    });
    return updated;
  });
}

export async function pendingCount(userId: string): Promise<number> {
  return db.queue.where('userId').equals(userId).count();
}

/** Replays queued actions in order. Safe to call concurrently (single flight). */
export function processQueue(userId: string): Promise<SyncResult> {
  processing ??= doProcess(userId).finally(() => {
    processing = null;
  });
  return processing;
}

async function doProcess(userId: string): Promise<SyncResult> {
  const result: SyncResult = { sent: 0, dropped: 0, remaining: 0, offline: false, authFailed: false };
  const ops = await db.queue.where('userId').equals(userId).sortBy('createdAt');

  for (const op of ops) {
    try {
      const path = `/worker/requests/${op.recipientId}/${op.type}`;
      const body = op.type === 'open' ? {} : { baseStateVersion: op.baseStateVersion, clientActionAt: op.clientActionAt, opId: op.opId };
      const res = await api<{ item?: WorkerRequest } & Partial<WorkerRequest>>(path, { method: 'POST', body });
      const item = (res.item ?? res) as WorkerRequest;
      await db.transaction('rw', db.queue, db.requests, async () => {
        await db.queue.delete(op.id!);
        await storeServerItem(userId, item);
      });
      result.sent++;
    } catch (e) {
      if (!(e instanceof ApiError)) throw e;
      if (e.isNetwork || e.status >= 500 || e.status === 429) {
        await db.queue.update(op.id!, { attempts: op.attempts + 1, lastError: e.code });
        result.offline = e.isNetwork;
        break; // keep order: stop and retry later
      }
      if (e.isAuth) {
        result.authFailed = true;
        break;
      }
      // 4xx: permanent for this action → drop it and adopt the server state.
      const serverItem = (e.details as { item?: WorkerRequest } | undefined)?.item;
      await db.transaction('rw', db.queue, db.requests, db.notices, async () => {
        await db.queue.delete(op.id!);
        if (serverItem) await storeServerItem(userId, serverItem);
        if (op.type !== 'open') {
          const title = serverItem?.title ?? (await db.requests.get(op.recipientId))?.title ?? '';
          await db.notices.add({
            userId,
            kind: e.code === 'REQUEST_CANCELLED' ? 'conflict-cancelled' : e.code === 'STALE_STATE' ? 'conflict-stale' : 'failed',
            recipientId: op.recipientId,
            title,
            createdAt: Date.now(),
          });
        }
      });
      result.dropped++;
    }
  }
  result.remaining = await db.queue.where('userId').equals(userId).count();
  return result;
}

/** Stores a server copy, re-applying any still-queued local actions on top of it. */
async function storeServerItem(userId: string, item: WorkerRequest): Promise<void> {
  const pending = await db.queue.where('recipientId').equals(item.recipientId).sortBy('createdAt');
  let merged: WorkerRequest = item;
  for (const op of pending) merged = applyLocally(merged, op.type, op.clientActionAt) ?? merged;
  await db.requests.put({ ...merged, userId });
}

/**
 * Pulls changes from the server (incremental after the first full sync).
 * Pending actions are flushed first so the server state already includes them.
 */
export async function pull(userId: string): Promise<{ changed: number; newItems: WorkerRequest[] }> {
  const since = await getMeta<string>(`${LAST_SYNC}:${userId}`);
  const res = await api<{ items: WorkerRequest[]; serverTime: string; full: boolean }>(
    `/worker/requests${since ? `?since=${encodeURIComponent(since)}` : ''}`,
  );
  const known = new Set((await db.requests.where('userId').equals(userId).primaryKeys()) as string[]);
  const newItems = res.items.filter((i) => !known.has(i.recipientId));

  if (res.full) {
    // Full snapshot: drop rows the server no longer returns (old history), keep anything with pending actions.
    const keep = new Set(res.items.map((i) => i.recipientId));
    const pendingIds = new Set((await db.queue.where('userId').equals(userId).toArray()).map((q) => q.recipientId));
    const stale = [...known].filter((id) => !keep.has(id) && !pendingIds.has(id));
    await db.requests.bulkDelete(stale);
  }
  for (const item of res.items) await storeServerItem(userId, item);
  await setMeta(`${LAST_SYNC}:${userId}`, res.serverTime);
  await setMeta(`worker.lastSyncAt:${userId}`, new Date().toISOString());
  return { changed: res.items.length, newItems };
}

/** Full cycle: push queued actions, then pull fresh data. */
export async function syncAll(userId: string): Promise<SyncResult & { newItems: WorkerRequest[] }> {
  const result = await processQueue(userId);
  if (result.offline || result.authFailed) return { ...result, newItems: [] };
  try {
    const { newItems } = await pull(userId);
    return { ...result, newItems };
  } catch (e) {
    if (e instanceof ApiError && (e.isNetwork || e.isAuth)) return { ...result, offline: e.isNetwork, authFailed: e.isAuth, newItems: [] };
    throw e;
  }
}
