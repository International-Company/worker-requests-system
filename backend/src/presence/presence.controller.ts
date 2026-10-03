import { Body, Controller, HttpCode, Post } from '@nestjs/common';
import { ApiProperty, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { IsBoolean } from 'class-validator';
import { AuthUser } from '../common/auth/auth-user';
import { CurrentUser, Roles } from '../common/auth/decorators';
import { PresenceService } from './presence.service';

class HeartbeatDto {
  @ApiProperty({ description: 'document.visibilityState === "visible"' })
  @IsBoolean()
  visible: boolean;
}

@ApiTags('presence')
@Controller('presence')
export class PresenceController {
  constructor(private readonly presence: PresenceService) {}

  @Post('heartbeat')
  @HttpCode(200)
  @Roles(Role.WORKER)
  heartbeat(@Body() dto: HeartbeatDto, @CurrentUser() user: AuthUser) {
    return this.presence.heartbeat(user.id, dto.visible);
  }
}
