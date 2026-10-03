import { Body, Controller, Get, HttpCode, Inject, Post, Req, Res } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { Role } from '@prisma/client';
import type { Request, Response } from 'express';
import { AuthUser } from '../common/auth/auth-user';
import { CurrentUser, Public, Roles } from '../common/auth/decorators';
import { APP_CONFIG, AppConfig } from '../config/app-config';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/auth.dto';
import { clearSessionCookie, setSessionCookie } from './session-cookie';

/**
 * Brute-force protection without account lock-out: a 4-digit PIN space is small,
 * so login is tightly rate-limited per client IP, per minute and per hour.
 */
export const LOGIN_THROTTLE = { default: { limit: 10, ttl: 60_000 }, hourly: { limit: 60, ttl: 3_600_000 } };

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  @Public()
  @Post('login')
  @HttpCode(200)
  @Throttle(LOGIN_THROTTLE)
  async login(@Body() dto: LoginDto, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const result = await this.auth.login(dto, { ip: req.ip ?? null, userAgent: req.headers['user-agent'] ?? null });
    setSessionCookie(res, result.token, result.expiresAt, this.config.cookieSecure);
    return { user: result.user, deviceReplaced: result.deviceReplaced };
  }

  @Post('logout')
  @HttpCode(204)
  @Roles(Role.SYSTEM_ADMIN, Role.MANAGER, Role.WORKER)
  async logout(@CurrentUser() user: AuthUser, @Res({ passthrough: true }) res: Response): Promise<void> {
    await this.auth.logout(user);
    clearSessionCookie(res, this.config.cookieSecure);
  }

  @Get('me')
  @Roles(Role.SYSTEM_ADMIN, Role.MANAGER, Role.WORKER)
  me(@CurrentUser() user: AuthUser) {
    return this.auth.me(user);
  }
}
