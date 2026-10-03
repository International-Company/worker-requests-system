import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { AuthUser } from '../common/auth/auth-user';
import { ClientIp, CurrentUser, Roles } from '../common/auth/decorators';
import { CreateRequestDto, ListRequestsQuery, ReopenRequestDto, ResendRequestDto, UpdateRequestDto } from './dto/request.dto';
import { RequestsService } from './requests.service';

/**
 * Manager/admin request API. Managers act on their own requests only;
 * the system admin can view and search every request (read-only).
 */
@ApiTags('requests')
@Controller('requests')
export class RequestsController {
  constructor(private readonly requests: RequestsService) {}

  @Get()
  @Roles(Role.SYSTEM_ADMIN, Role.MANAGER)
  list(@Query() q: ListRequestsQuery, @CurrentUser() user: AuthUser) {
    return this.requests.list(q, user);
  }

  @Get(':id')
  @Roles(Role.SYSTEM_ADMIN, Role.MANAGER)
  get(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthUser) {
    return this.requests.getWithNotifications(id, user);
  }

  @Post()
  @Roles(Role.MANAGER)
  create(@Body() dto: CreateRequestDto, @CurrentUser() user: AuthUser, @ClientIp() ip: string | null) {
    return this.requests.create(dto, user, ip);
  }

  @Patch(':id')
  @Roles(Role.MANAGER)
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateRequestDto,
    @CurrentUser() user: AuthUser,
    @ClientIp() ip: string | null,
  ) {
    return this.requests.update(id, dto, user, ip);
  }

  @Post(':id/cancel')
  @HttpCode(200)
  @Roles(Role.MANAGER)
  cancel(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthUser, @ClientIp() ip: string | null) {
    return this.requests.cancel(id, user, ip);
  }

  @Post(':id/resend')
  @HttpCode(200)
  @Roles(Role.MANAGER)
  resend(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ResendRequestDto,
    @CurrentUser() user: AuthUser,
    @ClientIp() ip: string | null,
  ) {
    return this.requests.resend(id, dto.idempotencyKey, user, ip);
  }

  @Post(':id/reopen')
  @HttpCode(200)
  @Roles(Role.MANAGER)
  reopen(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReopenRequestDto,
    @CurrentUser() user: AuthUser,
    @ClientIp() ip: string | null,
  ) {
    return this.requests.reopen(id, dto, user, ip);
  }
}
