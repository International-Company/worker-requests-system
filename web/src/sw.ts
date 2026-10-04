/// <reference lib="webworker" />
import { CacheableResponsePlugin } from 'workbox-cacheable-response';
import { ExpirationPlugin } from 'workbox-expiration';
import { cleanupOutdatedCaches, createHandlerBoundToURL, precacheAndRoute } from 'workbox-precaching';
import { NavigationRoute, registerRoute } from 'workbox-routing';
import { CacheFirst } from 'workbox-strategies';
import { getMeta } from './offline/db';
import { flushOutbox } from './offline/outbox';
import { syncAll } from './offline/worker-sync';

declare const self: ServiceWorkerGlobalScope;

/* ------------------------------------------------------------------ app shell / offline */

// Build-time list of hashed assets. Old precaches are removed on activation (cache invalidation).
precacheAndRoute(self.__WB_MANIFEST);
cleanupOutdatedCaches();

// Every in-app URL works offline: serve the cached index.html (never for /api).
registerRoute(new NavigationRoute(createHandlerBoundToURL('/index.html'), { denylist: [/^\/api\//] }));

// Request images are private and immutable: cache after first view so they stay
// viewable offline. The cache is wiped on logout (see clearPrivateCaches).
export const IMAGE_CACHE = 'private-images-v1';
registerRoute(
  ({ url, request }) =>
    url.origin === self.location.origin &&
    request.method === 'GET' &&
    (/^\/api\/attachments\/[0-9a-f-]{36}$/.test(url.pathname) || /^\/api\/workers\/[0-9a-f-]{36}\/photo$/.test(url.pathname)),
  new CacheFirst({
    cacheName: IMAGE_CACHE,
    plugins: [new CacheableResponsePlugin({ statuses: [200] }), new ExpirationPlugin({ maxEntries: 300, maxAgeSeconds: 30 * 24 * 3600 })],
  }),
);

/* ------------------------------------------------------------------ updates */

self.addEventListener('message', (event) => {
  const data = event.data as { type?: string } | undefined;
  if (data?.type === 'SKIP_WAITING') void self.skipWaiting();
  if (data?.type === 'CLEAR_PRIVATE_CACHES') event.waitUntil(caches.delete(IMAGE_CACHE));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

/* ------------------------------------------------------------------ push notifications */

interface PushPayload {
  type: 'NEW_REQUEST' | 'REMINDER' | 'REQUEST_UPDATED' | 'REQUEST_CANCELLED' | 'REQUEST_REOPENED';
  notificationId: string;
  recipientId: string;
  requestNumber: number;
  title: string;
  body: string;
  url: string;
  tag: string;
  requireInteraction: boolean;
  sentAt: string;
}

/** Long, attention-grabbing pattern (ms): vibrate, pause, vibrate… Ignored where unsupported (iOS). */
const ALERT_VIBRATION = [600, 250, 600, 250, 600, 250, 900];

self.addEventListener('push', (event) => {
  let payload: PushPayload;
  try {
    payload = event.data!.json() as PushPayload;
  } catch {
    return;
  }
  event.waitUntil(handlePush(payload));
});

async function handlePush(p: PushPayload): Promise<void> {
  const alerting = p.type !== 'REQUEST_CANCELLED';

  if (!alerting) {
    // Remove the pending "new request" alert of a cancelled request.
    for (const n of await self.registration.getNotifications({ tag: p.tag })) n.close();
  }

  // One notification per request (tag = request) — separate requests never merge;
  // reminders/edits of the SAME request re-alert (renotify) instead of stacking.
  const options: NotificationOptions & { renotify?: boolean; vibrate?: number[]; timestamp?: number } = {
    body: p.body,
    tag: p.tag,
    renotify: alerting,
    requireInteraction: p.requireInteraction, // stays on screen until handled (where supported)
    silent: false, // system default sound — browsers do not allow custom notification sounds
    vibrate: alerting ? ALERT_VIBRATION : [200],
    icon: '/icons/icon-192.png',
    badge: '/icons/badge-96.png',
    dir: 'rtl',
    lang: 'ar',
    timestamp: Date.parse(p.sentAt) || Date.now(),
    data: { url: p.url, recipientId: p.recipientId, notificationId: p.notificationId, type: p.type },
  };
  await self.registration.showNotification(p.title, options);

  // Tell open windows (refresh data + in-app alert) and report delivery to the server.
  const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
  for (const client of windows) client.postMessage({ type: 'PUSH_RECEIVED', payload: p });
  await reportDelivered(p.notificationId);
}

async function reportDelivered(notificationId: string): Promise<void> {
  try {
    await fetch(`/api/notifications/${notificationId}/delivered`, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'X-Requested-With': 'XMLHttpRequest' },
    });
  } catch {
    /* offline: delivery simply isn't confirmed */
  }
}

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = new URL((event.notification.data as { url?: string } | undefined)?.url ?? '/', self.location.origin).href;
  event.waitUntil(openOrFocus(url));
});

/** Opens the exact request: reuse an open app window if there is one. */
async function openOrFocus(url: string): Promise<void> {
  const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
  const sameApp = windows.find((c) => new URL(c.url).origin === self.location.origin);
  if (sameApp) {
    await sameApp.focus();
    sameApp.postMessage({ type: 'NAVIGATE', url: new URL(url).pathname });
    return;
  }
  await self.clients.openWindow(url);
}

// The browser rotated the push subscription: re-subscribe and register it (cookie session).
self.addEventListener('pushsubscriptionchange', (event) => {
  const e = event as Event & { oldSubscription?: PushSubscription; waitUntil(p: Promise<unknown>): void };
  e.waitUntil(
    (async () => {
      const key = (await getMeta<string>('push.vapidPublicKey')) ?? null;
      if (!key) return;
      const sub = await self.registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(key) });
      await fetch('/api/push/subscribe', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'X-Requested-With': 'XMLHttpRequest', 'Content-Type': 'application/json' },
        body: JSON.stringify({ endpoint: sub.endpoint, keys: sub.toJSON().keys }),
      });
    })().catch(() => undefined),
  );
});

/* ------------------------------------------------------------------ background sync */

export const SYNC_TAG = 'sync-queue';

// Chromium Background Sync: replays offline actions even if the app was closed after going offline.
self.addEventListener('sync', (event) => {
  const e = event as Event & { tag: string; waitUntil(p: Promise<unknown>): void };
  if (e.tag !== SYNC_TAG) return;
  e.waitUntil(runBackgroundSync());
});

async function runBackgroundSync(): Promise<void> {
  const user = await getMeta<{ id: string; role: string }>('currentUser');
  if (!user) return;
  if (user.role === 'WORKER') {
    const res = await syncAll(user.id);
    if (res.offline) throw new Error('still offline'); // tells the browser to retry later
  } else if (user.role === 'MANAGER') {
    await flushOutbox(user.id);
  }
  const windows = await self.clients.matchAll({ type: 'window' });
  for (const c of windows) c.postMessage({ type: 'SYNCED' });
}

function urlBase64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4);
  const raw = atob((base64 + padding).replace(/-/g, '+').replace(/_/g, '/'));
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}
