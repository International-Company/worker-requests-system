import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearUserData, db } from './db';
import { enqueueRequest, flushOutbox, sendOne } from './outbox';

const USER = 'manager-1';
let mode: 'offline' | 'online' | 'upload-then-drop' | 'invalid' = 'online';
const calls: string[] = [];

beforeEach(async () => {
  await clearUserData();
  calls.length = 0;
  let uploads = 0;
  // jsdom's FormData rejects the Node Blob instances returned by fake-indexeddb (real browsers store real Blobs).
  vi.stubGlobal(
    'FormData',
    class {
      parts: unknown[] = [];
      append(...args: unknown[]) {
        this.parts.push(args);
      }
    },
  );
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: RequestInit) => {
      calls.push(`${init.method} ${url}`);
      if (mode === 'offline') throw new TypeError('Failed to fetch');
      if (url === '/api/attachments') {
        uploads++;
        if (mode === 'upload-then-drop' && uploads > 1) throw new TypeError('Failed to fetch');
        return new Response(JSON.stringify({ id: `att-${uploads}` }), { status: 201 });
      }
      if (mode === 'invalid') return new Response(JSON.stringify({ code: 'INVALID_RECIPIENTS', message: 'بعض العمال غير فعالين' }), { status: 400 });
      const body = JSON.parse(String(init.body));
      return new Response(JSON.stringify({ id: 'req-1', ...body }), { status: 201 });
    }),
  );
});
afterEach(() => vi.unstubAllGlobals());

const img = (id: string) => ({ clientUploadId: id, blob: new Blob(['x'], { type: 'image/jpeg' }), name: `${id}.jpg` });

async function enqueue() {
  return enqueueRequest({
    userId: USER,
    idempotencyKey: 'key-123456789',
    title: 'إحضار المستندات',
    targetType: 'SINGLE',
    workerIds: ['w1'],
    images: [img('u1'), img('u2')],
  });
}

describe('manager outbox', () => {
  it('online: uploads images then creates the request with the same idempotency key, then removes the entry', async () => {
    await enqueue();
    const outcome = await sendOne('key-123456789');
    expect(outcome.kind).toBe('sent');
    expect(calls).toEqual(['POST /api/attachments', 'POST /api/attachments', 'POST /api/requests']);
    expect(await db.outbox.count()).toBe(0);
  });

  it('offline: the request is kept (never lost) and reported as queued', async () => {
    mode = 'offline';
    await enqueue();
    expect(await sendOne('key-123456789')).toEqual({ kind: 'queued', reason: 'offline' });
    expect(await db.outbox.get('key-123456789')).toMatchObject({ status: 'pending', attempts: 1 });
  });

  it('connection lost mid-upload: progress is remembered, retry does not re-upload finished images', async () => {
    mode = 'upload-then-drop';
    await enqueue();
    expect((await sendOne('key-123456789')).kind).toBe('queued');
    const saved = await db.outbox.get('key-123456789');
    expect(saved!.images.map((i) => i.attachmentId)).toEqual(['att-1', undefined]);

    mode = 'online';
    calls.length = 0;
    await flushOutbox(USER);
    expect(calls).toEqual(['POST /api/attachments', 'POST /api/requests']);
    expect(await db.outbox.count()).toBe(0);
  });

  it('validation errors are permanent: not retried automatically, message kept for the manager', async () => {
    mode = 'invalid';
    await enqueue();
    const outcome = await sendOne('key-123456789');
    expect(outcome).toEqual({ kind: 'failed', message: 'بعض العمال غير فعالين' });
    calls.length = 0;
    await flushOutbox(USER);
    expect(calls).toEqual([]);
    expect(await db.outbox.get('key-123456789')).toMatchObject({ permanent: true, status: 'failed' });
  });

  afterEach(() => {
    mode = 'online';
  });
});
