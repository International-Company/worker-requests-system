import { fmt, t } from '../i18n';

const pad = (n: number) => String(n).padStart(2, '0');

/** Fixed, locale-independent formats (24h, seconds). Rendered inside .ltr-nums so digits never reorder in RTL text. */
function parts(iso: string) {
  const d = new Date(iso);
  return {
    date: `${d.getFullYear()}/${pad(d.getMonth() + 1)}/${pad(d.getDate())}`,
    time: `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`,
  };
}

/** Full timestamp with seconds, e.g. 2026/10/03 14:20:05 (device local time of a server timestamp). */
export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return t.common.none;
  const p = parts(iso);
  return `${p.date} ${p.time}`;
}

export function formatTime(iso: string | null | undefined): string {
  if (!iso) return t.common.none;
  return parts(iso).time;
}

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return t.common.none;
  return parts(iso).date;
}

/** "منذ 4 دقائق" style relative time. */
export function timeAgo(iso: string | null | undefined, now: number = Date.now()): string {
  if (!iso) return t.presence.never;
  const sec = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000));
  if (sec < 10) return t.time.justNow;
  if (sec < 60) return t.time.secondsAgo;
  const min = Math.floor(sec / 60);
  if (min === 1) return t.time.minuteAgo;
  if (min < 60) return fmt(t.time.minutesAgo, { n: min });
  const hours = Math.floor(min / 60);
  if (hours === 1) return t.time.hourAgo;
  if (hours < 24) return fmt(t.time.hoursAgo, { n: hours });
  const days = Math.floor(hours / 24);
  if (days === 1) return t.time.dayAgo;
  return fmt(t.time.daysAgo, { n: days });
}

/** Today's / a past date as YYYY-MM-DD in local time (for <input type=date>). */
export function isoDay(d: Date = new Date()): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
