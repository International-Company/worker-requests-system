export interface PushTarget {
  endpoint: string;
  p256dh: string;
  auth: string;
}

/** JSON payload delivered to the service worker `push` event (must stay < 4 KB). */
export interface PushPayload {
  type: 'NEW_REQUEST' | 'REMINDER' | 'REQUEST_UPDATED' | 'REQUEST_CANCELLED' | 'REQUEST_REOPENED';
  notificationId: string;
  recipientId: string;
  requestNumber: number;
  title: string;
  body: string;
  /** In-app route opened when the notification is clicked. */
  url: string;
  /** Same tag per request → one notification per request, replaced (not stacked) on reminders/edits. */
  tag: string;
  requireInteraction: boolean;
  sentAt: string;
}

export type PushResult =
  | { ok: true }
  | { ok: false; error: string; subscriptionGone: boolean; retryable: boolean };

export interface PushProvider {
  readonly enabled: boolean;
  readonly publicKey: string | null;
  send(target: PushTarget, payload: PushPayload, ttlSeconds: number): Promise<PushResult>;
}

export const PUSH_PROVIDER = Symbol('PUSH_PROVIDER');
