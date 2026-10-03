import { createHash, randomBytes } from 'crypto';

export function sha256Hex(input: string | Buffer): string {
  return createHash('sha256').update(input).digest('hex');
}

/** 256-bit URL-safe random token. */
export function randomToken(): string {
  return randomBytes(32).toString('base64url');
}
