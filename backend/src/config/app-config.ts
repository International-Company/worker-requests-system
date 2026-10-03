import { Logger } from '@nestjs/common';

export interface VapidConfig {
  publicKey: string;
  privateKey: string;
  subject: string;
}

export interface AppConfig {
  nodeEnv: string;
  isProduction: boolean;
  port: number;
  appUrl: string;
  databaseUrl: string;
  /** Secret for PIN HMAC and session-token HMAC. */
  authSecret: string;
  sessionTtlDaysStaff: number;
  sessionTtlDaysWorker: number;
  corsOrigins: string[];
  trustProxy: boolean;
  cookieSecure: boolean;
  webDistPath: string | null;
  maxUploadBytes: number;
  vapid: VapidConfig | null;
}

const MIN_SECRET_LENGTH = 32;

function required(env: NodeJS.ProcessEnv, key: string): string {
  const value = env[key];
  if (!value || value.trim() === '') throw new Error(`Missing required environment variable: ${key}`);
  return value.trim();
}

function int(env: NodeJS.ProcessEnv, key: string, fallback: number): number {
  const raw = env[key];
  if (raw === undefined || raw === '') return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) throw new Error(`Invalid numeric environment variable: ${key}`);
  return Math.floor(n);
}

function bool(env: NodeJS.ProcessEnv, key: string, fallback: boolean): boolean {
  const raw = env[key];
  if (raw === undefined || raw === '') return fallback;
  return ['1', 'true', 'yes'].includes(raw.toLowerCase());
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const nodeEnv = env.NODE_ENV ?? 'development';
  const isProduction = nodeEnv === 'production';

  const authSecret = required(env, 'AUTH_SECRET');
  if (authSecret.length < MIN_SECRET_LENGTH) {
    throw new Error(`AUTH_SECRET must be at least ${MIN_SECRET_LENGTH} characters`);
  }

  const appUrl = (env.APP_URL ?? `http://localhost:${env.PORT ?? 3000}`).replace(/\/+$/, '');
  if (isProduction && !appUrl.startsWith('https://')) {
    throw new Error('APP_URL must use https:// in production (required for PWA, Service Worker and Push)');
  }

  const corsOrigins = (env.CORS_ORIGIN ?? '')
    .split(',')
    .map((s) => s.trim().replace(/\/+$/, ''))
    .filter(Boolean);

  let vapid: VapidConfig | null = null;
  if (env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY) {
    vapid = {
      publicKey: env.VAPID_PUBLIC_KEY.trim(),
      privateKey: env.VAPID_PRIVATE_KEY.trim(),
      subject: (env.VAPID_SUBJECT ?? appUrl).trim(),
    };
  } else {
    new Logger('Config').warn('VAPID keys not configured — Web Push notifications are DISABLED');
  }

  return {
    nodeEnv,
    isProduction,
    port: int(env, 'PORT', 3000),
    appUrl,
    databaseUrl: required(env, 'DATABASE_URL'),
    authSecret,
    sessionTtlDaysStaff: int(env, 'SESSION_TTL_DAYS_STAFF', 7),
    sessionTtlDaysWorker: int(env, 'SESSION_TTL_DAYS_WORKER', 60),
    corsOrigins,
    trustProxy: bool(env, 'TRUST_PROXY', isProduction),
    cookieSecure: bool(env, 'COOKIE_SECURE', isProduction),
    webDistPath: env.WEB_DIST_PATH?.trim() || null,
    maxUploadBytes: int(env, 'MAX_UPLOAD_MB', 10) * 1024 * 1024,
    vapid,
  };
}

export const APP_CONFIG = Symbol('APP_CONFIG');
