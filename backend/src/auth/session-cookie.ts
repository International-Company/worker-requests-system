import type { CookieOptions, Response } from 'express';

export const SESSION_COOKIE = 'wr_session';

export function sessionCookieOptions(secure: boolean): CookieOptions {
  return { httpOnly: true, secure, sameSite: 'strict', path: '/api' };
}

export function setSessionCookie(res: Response, token: string, expiresAt: Date, secure: boolean): void {
  res.cookie(SESSION_COOKIE, token, { ...sessionCookieOptions(secure), expires: expiresAt });
}

export function clearSessionCookie(res: Response, secure: boolean): void {
  res.clearCookie(SESSION_COOKIE, sessionCookieOptions(secure));
}
