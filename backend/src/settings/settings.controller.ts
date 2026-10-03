import { Body, Controller, Get, Patch } from '@nestjs/common';
import { ApiBearerAuth, ApiProperty, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { IsObject } from 'class-validator';
import { AuthUser } from '../common/auth/auth-user';
import { ClientIp, CurrentUser, Roles } from '../common/auth/decorators';
import { SettingsService } from './settings.service';

class UpdateSettingsDto {
  @ApiProperty({ example: { 'notifications.reminderIntervalSeconds': 300 } })
  @IsObject()
  values: Record<string, unknown>;
}

@ApiTags('settings')
@ApiBearerAuth()
@Controller('settings')
export class SettingsController {
  constructor(private readonly settings: SettingsService) {}

  @Get()
  @Roles(Role.SYSTEM_ADMIN)
  getAll() {
    return this.settings.getAll();
  }

  @Patch()
  @Roles(Role.SYSTEM_ADMIN)
  update(@Body() dto: UpdateSettingsDto, @CurrentUser() user: AuthUser, @ClientIp() ip: string | null) {
    return this.settings.update(dto.values, user, ip);
  }

  /** Public-ish (any authenticated role) subset needed by clients. */
  @Get('client')
  @Roles(Role.SYSTEM_ADMIN, Role.MANAGER, Role.WORKER)
  async client() {
    return {
      companyName: await this.settings.get('system.companyName'),
      heartbeatIntervalSeconds: await this.settings.get('presence.heartbeatIntervalSeconds'),
      onlineThresholdSeconds: await this.settings.get('presence.onlineThresholdSeconds'),
      maxImagesPerRequest: 3,
    };
  }
}
