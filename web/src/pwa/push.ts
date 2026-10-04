import { del, get, post } from '../lib/api';
import { isIos, isStandalone } from '../lib/device';
import { setMeta } from '../offline/db';

export type PushState = 'unsupported' | 'ios-needs-install' | 'server-disabled' | 'denied' | 'prompt' | 'subscribed';

export function pushSupported(): boolean {
  return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
}

export async function getPushState(): Promise<PushState> {
  if (!pushSupported()) return isIos() && !isStandalone() ? 'ios-needs-install' : 'unsupported';
  const status = await get<{ enabled: boolean; subscribed: boolean; vapidPublicKey: string | null }>('/push/status');
  if (!status.enabled || !status.vapidPublicKey) return 'server-disabled';
  if (Notification.permission === 'denied') return 'denied';
  const reg = await navigator.serviceWorker.ready;
  const sub = await reg.pushManager.getSubscription();
  if (Notification.permission === 'granted' && sub && status.subscribed) return 'subscribed';
  // Permission granted but this browser's subscription is missing/unknown to the server: re-register silently.
  if (Notification.permission === 'granted') {
    try {
      await subscribe(status.vapidPublicKey);
      return 'subscribed';
    } catch {
      return 'prompt';
    }
  }
  return 'prompt';
}

/** Must be called from a user gesture (button click) — browsers require it. */
export async function enablePush(): Promise<PushState> {
  if (!pushSupported()) return 'unsupported';
  const status = await get<{ enabled: boolean; vapidPublicKey: string | null }>('/push/status');
  if (!status.enabled || !status.vapidPublicKey) return 'server-disabled';
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') return permission === 'denied' ? 'denied' : 'prompt';
  await subscribe(status.vapidPublicKey);
  return 'subscribed';
}

async function subscribe(vapidPublicKey: string): Promise<void> {
  const reg = await navigator.serviceWorker.ready;
  let sub = await reg.pushManager.getSubscription();
  const key = urlBase64ToUint8Array(vapidPublicKey);
  // A subscription made with a different (old) VAPID key cannot be reused.
  if (sub && !sameKey(sub.options.applicationServerKey, key)) {
    await sub.unsubscribe();
    sub = null;
  }
  sub ??= await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
  await setMeta('push.vapidPublicKey', vapidPublicKey); // used by the SW on pushsubscriptionchange
  await post('/push/subscribe', subscriptionBody(sub));
}

/** Only endpoint + encryption keys are needed by the server. */
export function subscriptionBody(sub: PushSubscription): { endpoint: string; keys: { p256dh: string; auth: string } } {
  const json = sub.toJSON();
  return { endpoint: sub.endpoint, keys: { p256dh: json.keys?.p256dh ?? '', auth: json.keys?.auth ?? '' } };
}

export async function disablePushOnThisDevice(): Promise<void> {
  if (!pushSupported()) return;
  const reg = await navigator.serviceWorker.getRegistration();
  const sub = await reg?.pushManager.getSubscription();
  if (!sub) return;
  await del('/push/subscribe', { endpoint: sub.endpoint }).catch(() => undefined);
  await sub.unsubscribe().catch(() => undefined);
}

function sameKey(a: ArrayBuffer | null, b: Uint8Array): boolean {
  if (!a) return false;
  const x = new Uint8Array(a);
  return x.length === b.length && x.every((v, i) => v === b[i]);
}

function urlBase64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4);
  const raw = atob((base64 + padding).replace(/-/g, '+').replace(/_/g, '/'));
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}
