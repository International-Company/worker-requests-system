import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { AuthUser } from '../common/auth/auth-user';
import { ClientIp, CurrentUser, Roles } from '../common/auth/decorators';
import { AppException } from '../common/errors/app.exception';
import { DevicesService } from '../devices/devices.service';
import { ChangePinDto } from '../workers/dto/worker.dto';
import { CreateManagerDto, UpdateManagerDto } from './dto/manager.dto';
import { ManagersService } from './managers.service';

@ApiTags('managers')
@Roles(Role.SYSTEM_ADMIN)
@Controller('managers')
export class ManagersController {
  constructor(
    private readonly managers: ManagersService,
    private readonly devices: DevicesService,
  ) {}

  @Get()
  list() {
    return this.managers.list();
  }

  @Post()
  create(@Body() dto: CreateManagerDto, @CurrentUser() user: AuthUser, @ClientIp() ip: string | null) {
    return this.managers.create(dto, user, ip);
  }

  @Patch(':id')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateManagerDto,
    @CurrentUser() user: AuthUser,
    @ClientIp() ip: string | null,
  ) {
    return this.managers.update(id, dto, user, ip);
  }

  @Post(':id/change-pin')
  @HttpCode(204)
  async changePin(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ChangePinDto,
    @CurrentUser() user: AuthUser,
    @ClientIp() ip: string | null,
  ): Promise<void> {
    await this.managers.changePin(id, dto.pin, user, ip);
  }

  /** "فصل الحساب/الجهاز": signs the account out of every browser. */
  @Post(':id/disconnect-device')
  @HttpCode(204)
  async disconnect(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthUser, @ClientIp() ip: string | null) {
    if (id === user.id) throw new AppException('CANNOT_MODIFY_SELF');
    await this.managers.get(id);
    await this.devices.disconnectUser(id, user, ip);
  }

  @Delete(':id')
  @HttpCode(204)
  async remove(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthUser, @ClientIp() ip: string | null) {
    await this.managers.remove(id, user, ip);
  }
}
