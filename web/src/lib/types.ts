export type Role = 'SYSTEM_ADMIN' | 'MANAGER' | 'WORKER';
export type RecipientStatus = 'NEW' | 'ACKNOWLEDGED' | 'COMPLETED' | 'CANCELLED';
export type TargetType = 'SINGLE' | 'MULTIPLE' | 'ALL';

export interface Me {
  id: string;
  name: string;
  role: Role;
  lastLoginAt: string | null;
  phone: string | null;
  photoVersion: string | null;
  device: { id: string; label: string | null; boundAt: string } | null;
  serverTime: string;
}

export interface AttachmentMeta {
  id: string;
  position: number;
  width: number;
  height: number;
  mimeType?: string;
  sizeBytes?: number;
}

export interface Recipient {
  id: string;
  workerId: string;
  workerName: string;
  status: RecipientStatus;
  stateVersion: number;
  deliveredAt: string | null;
  openedAt: string | null;
  acknowledgedAt: string | null;
  completedAt: string | null;
  cancelledAt: string | null;
  reopenedAt: string | null;
  lastNotifiedAt: string | null;
  reminderCount: number;
  createdAt: string;
}

export interface RequestView {
  id: string;
  number: number;
  title: string;
  status: 'ACTIVE' | 'CANCELLED';
  targetType: TargetType;
  version: number;
  createdAt: string;
  updatedAt: string;
  editedAt: string | null;
  cancelledAt: string | null;
  resentFromId: string | null;
  createdBy: { id: string; name: string };
  attachments: AttachmentMeta[];
  counts: Record<RecipientStatus, number>;
  recipients: Recipient[];
  replayed?: boolean;
}

export interface NotificationRow {
  id: string;
  recipientId: string;
  type: 'NEW_REQUEST' | 'REMINDER' | 'REQUEST_UPDATED' | 'REQUEST_CANCELLED' | 'REQUEST_REOPENED';
  status: 'PENDING' | 'SENT' | 'DELIVERED' | 'FAILED' | 'SKIPPED';
  error: string | null;
  attempts: number;
  sentAt: string | null;
  deliveredAt: string | null;
  createdAt: string;
}

export interface RequestDetail extends RequestView {
  notifications: NotificationRow[];
}

export interface Paged<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

/** The worker's own copy of a request (cached offline in IndexedDB). */
export interface WorkerRequest {
  recipientId: string;
  requestId: string;
  number: number;
  title: string;
  managerName: string;
  requestStatus: 'ACTIVE' | 'CANCELLED';
  requestVersion: number;
  status: RecipientStatus;
  stateVersion: number;
  sentAt: string;
  editedAt: string | null;
  deliveredAt: string | null;
  openedAt: string | null;
  acknowledgedAt: string | null;
  completedAt: string | null;
  cancelledAt: string | null;
  reopenedAt: string | null;
  updatedAt: string;
  attachments: Array<{ id: string; width: number; height: number; position: number }>;
}

export interface Worker {
  id: string;
  name: string;
  phone: string;
  isActive: boolean;
  photoVersion: string | null;
  lastLoginAt: string | null;
  createdAt: string;
  isOnline: boolean;
  lastSeenAt: string | null;
  device: { label: string | null; boundAt: string; lastSeenAt: string | null; pushEnabled: boolean } | null;
}

export interface StaffAccount {
  id: string;
  name: string;
  role: 'SYSTEM_ADMIN' | 'MANAGER';
  isActive: boolean;
  lastLoginAt: string | null;
  createdAt: string;
  activeSessions: number;
  lastActivityAt: string | null;
}

export interface DashboardStats {
  onlineWorkers: number;
  activeWorkers: number;
  newRequests: number;
  inProgress: number;
  completedToday: number;
  cancelledToday: number;
  serverTime: string;
}

export interface SettingItem {
  key: string;
  type: 'number' | 'boolean' | 'string';
  label: string;
  group: string;
  value: number | boolean | string;
  min?: number;
  max?: number;
  maxLength?: number;
  unit?: string;
}

export interface LoginLogRow {
  id: string;
  userId: string;
  role: Role;
  deviceKey: string | null;
  ip: string | null;
  userAgent: string | null;
  createdAt: string;
  user: { id: string; name: string };
  session: { lastUsedAt: string; revokedAt: string | null; expiresAt: string } | null;
}

export interface AuditLogRow {
  id: string;
  actorId: string | null;
  actorRole: Role | null;
  action: string;
  entityType: string;
  entityId: string | null;
  metadata: Record<string, unknown> | null;
  ip: string | null;
  createdAt: string;
  actor: { id: string; name: string; role: Role } | null;
}
