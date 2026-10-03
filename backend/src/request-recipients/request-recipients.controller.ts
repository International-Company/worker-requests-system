import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { AuthUser } from '../common/auth/auth-user';
import { ClientIp, CurrentUser, Roles } from '../common/auth/decorators';
import { WorkerActionDto, WorkerListQuery } from '../requests/dto/request.dto';
import { RequestRecipientsService } from './request-recipients.service';

/**
 * Worker API. `:id` is the recipient id (the worker's own copy of a request).
 * All actions are idempotent so the offline sync queue can safely retry them.
 */
@ApiTags('worker')
@Roles(Role.WORKER)
@Controller('worker/requests')
export class RequestRecipientsController {
  constructor(private readonly recipients: RequestRecipientsService) {}

  @Get()
  list(@Query() q: WorkerListQuery, @CurrentUser() user: AuthUser) {
    return this.recipients.list(user.id, q.since);
  }

  @Get(':id')
  get(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthUser) {
    return this.recipients.get(user.id, id);
  }

  @Post(':id/open')
  @HttpCode(200)
  open(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthUser) {
    return this.recipients.open(user, id);
  }

  @Post(':id/acknowledge')
  @HttpCode(200)
  acknowledge(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: WorkerActionDto,
    @CurrentUser() user: AuthUser,
    @ClientIp() ip: string | null,
  ) {
    return this.recipients.acknowledge(user, id, dto, ip);
  }

  @Post(':id/complete')
  @HttpCode(200)
  complete(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: WorkerActionDto,
    @CurrentUser() user: AuthUser,
    @ClientIp() ip: string | null,
  ) {
    return this.recipients.complete(user, id, dto, ip);
  }
}
