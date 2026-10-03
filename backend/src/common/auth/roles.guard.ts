import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Role } from '@prisma/client';
import type { Request } from 'express';
import { AppException } from '../errors/app.exception';
import { AuthUser } from './auth-user';
import { IS_PUBLIC_KEY, ROLES_KEY } from './decorators';

/**
 * Global role-based authorization. Routes without @Roles() are denied to everyone
 * except when marked @Public — "deny by default" so a forgotten decorator never leaks data.
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const targets = [context.getHandler(), context.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, targets)) return true;

    const roles = this.reflector.getAllAndOverride<Role[] | undefined>(ROLES_KEY, targets);
    const user = context.switchToHttp().getRequest<Request & { user?: AuthUser }>().user;
    if (!user) throw new AppException('UNAUTHENTICATED');
    if (!roles || roles.length === 0 || !roles.includes(user.role)) {
      throw new AppException('FORBIDDEN');
    }
    return true;
  }
}
