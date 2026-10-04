import { Body, Controller, Delete, Get, HttpCode, Post } from '@nestjs/common';
import { ApiProperty, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { Type } from 'class-transformer';
import { IsNumber, IsOptional, IsString, IsUrl, MaxLength, ValidateNested } from 'class-validator';
import { AuthUser } from '../common/auth/auth-user';
import { CurrentUser, Roles } from '../common/auth/decorators';
import { DevicesService } from './devices.service';

class PushKeysDto {
  @ApiProperty()
  @IsString()
  @MaxLength(256)
  p256dh: string;

  @ApiProperty()
  @IsString()
  @MaxLength(128)
  auth: string;
}

class SubscribeDto {
  @ApiProperty({ description: 'PushSubscription.endpoint' })
  @IsUrl({ protocols: ['https'], require_protocol: true, require_tld: false })
  @MaxLength(1024)
  endpoint: string;

  @ApiProperty({ type: PushKeysDto })
  @ValidateNested()
  @Type(() => PushKeysDto)
  keys: PushKeysDto;

  /** Part of PushSubscription.toJSON() in every browser (usually null). Accepted, not stored. */
  @ApiProperty({ required: false, nullable: true, type: Number })
  @IsOptional()
  @IsNumber()
  expirationTime?: number | null;
}

class UnsubscribeDto {
  @ApiProperty()
  @IsString()
  @MaxLength(1024)
  endpoint: string;
}

/** Web Push subscriptions — only workers receive request notifications. */
@ApiTags('push')
@Controller('push')
export class PushSubscriptionsController {
  constructor(private readonly devices: DevicesService) {}

  @Get('status')
  @Roles(Role.WORKER, Role.MANAGER, Role.SYSTEM_ADMIN)
  status(@CurrentUser() user: AuthUser) {
    return this.devices.pushStatus(user.deviceRowId);
  }

  @Post('subscribe')
  @HttpCode(204)
  @Roles(Role.WORKER)
  async subscribe(@Body() dto: SubscribeDto, @CurrentUser() user: AuthUser): Promise<void> {
    await this.devices.subscribe(user.deviceRowId, { endpoint: dto.endpoint, p256dh: dto.keys.p256dh, auth: dto.keys.auth });
  }

  @Delete('subscribe')
  @HttpCode(204)
  @Roles(Role.WORKER)
  async unsubscribe(@Body() dto: UnsubscribeDto, @CurrentUser() user: AuthUser): Promise<void> {
    await this.devices.unsubscribe(user.deviceRowId, dto.endpoint);
  }
}
