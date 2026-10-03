import { Controller, HttpCode, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { Role } from '@prisma/client';
import { AuthUser } from '../common/auth/auth-user';
import { CurrentUser, Roles } from '../common/auth/decorators';
import { NotificationsService } from './notifications.service';

@ApiTags('notifications')
@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  /** Delivery receipt sent by the service worker when a push arrives. */
  @Post(':id/delivered')
  @HttpCode(204)
  @Roles(Role.WORKER)
  @Throttle({ default: { limit: 120, ttl: 60_000 } })
  async delivered(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthUser): Promise<void> {
    await this.notifications.markDelivered(id, user.id);
  }
}
