import { CanActivate, ExecutionContext, Inject, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request, Response } from 'express';
import { SESSION_COOKIE, setSessionCookie } from '../../auth/session-cookie';
import { SessionService } from '../../auth/session.service';
import { APP_CONFIG, AppConfig } from '../../config/app-config';
import { AppException } from '../errors/app.exception';
import { AuthUser } from './auth-user';
import { IS_PUBLIC_KEY } from './decorators';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * Global guard:
 *  1. CSRF — state-changing requests must carry `X-Requested-With: XMLHttpRequest`
 *     (cannot be sent cross-site without a CORS preflight we never allow) and, if the
 *     browser sends an Origin header, it must be our own. Combined with the
 *     SameSite=Strict cookie this blocks cross-site request forgery.
 *  2. Authentication — validates the session cookie (unless the route is @Public).
 */
@Injectable()
export class SessionAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly sessions: SessionService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (context.getType() !== 'http') return true;
    const req = context.switchToHttp().getRequest<Request & { user?: AuthUser }>();
    const res = context.switchToHttp().getResponse<Response>();

    if (!SAFE_METHODS.has(req.method)) this.assertCsrf(req);

    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [context.getHandler(), context.getClass()]);
    if (isPublic) return true;

    const token = (req.cookies as Record<string, string> | undefined)?.[SESSION_COOKIE];
    if (!token) throw new AppException('UNAUTHENTICATED');

    const { user, expiresAt, renewed } = await this.sessions.validate(token);
    if (renewed) setSessionCookie(res, token, expiresAt, this.config.cookieSecure);
    req.user = user;
    return true;
  }

  private assertCsrf(req: Request): void {
    if (req.headers['x-requested-with'] !== 'XMLHttpRequest') throw new AppException('FORBIDDEN');
    const origin = req.headers.origin;
    if (origin) {
      const allowed = [this.config.appUrl, ...this.config.corsOrigins];
      if (!allowed.includes(origin.replace(/\/+$/, ''))) throw new AppException('FORBIDDEN');
    }
  }
}
