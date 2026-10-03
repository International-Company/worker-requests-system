import { registerSW } from 'virtual:pwa-register';

/**
 * Service-worker registration + messaging bridge for the React app.
 * `registerType: 'prompt'` → a new version waits until the user accepts the update
 * banner, so a worker is never reloaded in the middle of an action.
 */
type Listener = (msg: { type: string; payload?: unknown; url?: string }) => void;
const listeners = new Set<Listener>();
let updateSW: ((reload?: boolean) => Promise<void>) | null = null;
let needRefreshCallback: (() => void) | null = null;

export function initServiceWorker(): void {
  if (!('serviceWorker' in navigator)) return;
  updateSW = registerSW({
    immediate: true,
    onNeedRefresh() {
      needRefreshCallback?.();
    },
    onRegisteredSW(_url, registration) {
      // Check for a new version every hour while the app is open.
      if (registration) setInterval(() => void registration.update(), 3_600_000);
    },
  });
  navigator.serviceWorker.addEventListener('message', (event) => {
    for (const l of listeners) l(event.data as { type: string });
  });
}

export function onSwMessage(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function onNeedRefresh(cb: () => void): void {
  needRefreshCallback = cb;
}

export function applyUpdate(): void {
  void updateSW?.(true);
}

/** Asks the browser to run the queued sync even if the app gets closed (Chromium only). */
export async function requestBackgroundSync(): Promise<void> {
  try {
    const reg = (await navigator.serviceWorker?.ready) as ServiceWorkerRegistration & {
      sync?: { register(tag: string): Promise<void> };
    };
    await reg?.sync?.register('sync-queue');
  } catch {
    /* unsupported (Safari/Firefox): the app retries on "online" / focus / timer instead */
  }
}

export async function clearPrivateCaches(): Promise<void> {
  const reg = await navigator.serviceWorker?.getRegistration();
  reg?.active?.postMessage({ type: 'CLEAR_PRIVATE_CACHES' });
  await caches?.delete('private-images-v1').catch(() => undefined);
}
