/**
 * Browser/PWA identity. A random id is generated once and kept in localStorage;
 * the server binds it to the account at login (one active device per worker).
 * It is not a secret — authentication is the httpOnly session cookie.
 */
const KEY = 'wr.deviceKey';

export function uuid(): string {
  // randomUUID needs a secure context (HTTPS/localhost); fall back to getRandomValues.
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

export function getDeviceKey(): string {
  try {
    let key = localStorage.getItem(KEY);
    if (!key || !/^[A-Za-z0-9-]{16,64}$/.test(key)) {
      key = uuid();
      localStorage.setItem(KEY, key);
    }
    return key;
  } catch {
    return uuid();
  }
}

/** Human readable label, e.g. "Android · Chrome · تطبيق مثبت". */
export function getDeviceLabel(): string {
  const ua = navigator.userAgent;
  const os = /Android/i.test(ua)
    ? 'Android'
    : /iPhone|iPad|iPod/i.test(ua)
      ? 'iOS'
      : /Windows/i.test(ua)
        ? 'Windows'
        : /Mac OS X/i.test(ua)
          ? 'macOS'
          : /Linux/i.test(ua)
            ? 'Linux'
            : 'Unknown';
  const browser = /Edg\//.test(ua)
    ? 'Edge'
    : /SamsungBrowser/.test(ua)
      ? 'Samsung Internet'
      : /Chrome\//.test(ua)
        ? 'Chrome'
        : /Firefox\//.test(ua)
          ? 'Firefox'
          : /Safari\//.test(ua)
            ? 'Safari'
            : 'Browser';
  return [os, browser, isStandalone() ? 'تطبيق مثبت' : null].filter(Boolean).join(' · ');
}

export function isStandalone(): boolean {
  return (
    window.matchMedia?.('(display-mode: standalone)').matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

export function isIos(): boolean {
  return /iPhone|iPad|iPod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}
