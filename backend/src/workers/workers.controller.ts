import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBody, ApiConsumes, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { Transform } from 'class-transformer';
import { IsBoolean, IsOptional, IsString, MaxLength } from 'class-validator';
import type { Response } from 'express';
import { AuthUser } from '../common/auth/auth-user';
import { ClientIp, CurrentUser, Roles } from '../common/auth/decorators';
import { AppException } from '../common/errors/app.exception';
import { DEFAULT_MAX_UPLOAD_BYTES, imageUploadOptions } from '../common/upload/image-upload.options';
import { DevicesService } from '../devices/devices.service';
import { ChangePinDto, CreateWorkerDto, UpdateWorkerDto } from './dto/worker.dto';
import { WorkersService } from './workers.service';

class ListWorkersQuery {
  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  includeInactive: boolean = true;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(60)
  q?: string;
}

@ApiTags('workers')
@Controller('workers')
export class WorkersController {
  constructor(
    private readonly workers: WorkersService,
    private readonly devices: DevicesService,
  ) {}

  @Get()
  @Roles(Role.SYSTEM_ADMIN, Role.MANAGER)
  list(@Query() q: ListWorkersQuery) {
    return this.workers.list(q);
  }

  @Get(':id')
  @Roles(Role.SYSTEM_ADMIN, Role.MANAGER)
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.workers.get(id);
  }

  @Post()
  @Roles(Role.SYSTEM_ADMIN, Role.MANAGER)
  create(@Body() dto: CreateWorkerDto, @CurrentUser() user: AuthUser, @ClientIp() ip: string | null) {
    return this.workers.create(dto, user, ip);
  }

  @Patch(':id')
  @Roles(Role.SYSTEM_ADMIN, Role.MANAGER)
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateWorkerDto,
    @CurrentUser() user: AuthUser,
    @ClientIp() ip: string | null,
  ) {
    return this.workers.update(id, dto, user, ip);
  }

  @Post(':id/change-pin')
  @HttpCode(204)
  @Roles(Role.SYSTEM_ADMIN, Role.MANAGER)
  async changePin(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ChangePinDto,
    @CurrentUser() user: AuthUser,
    @ClientIp() ip: string | null,
  ): Promise<void> {
    await this.workers.changePin(id, dto.pin, user, ip);
  }

  @Post(':id/disconnect-device')
  @HttpCode(204)
  @Roles(Role.SYSTEM_ADMIN, Role.MANAGER)
  async disconnectDevice(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthUser,
    @ClientIp() ip: string | null,
  ): Promise<void> {
    await this.workers.get(id); // 404 for non-workers
    await this.devices.disconnectUser(id, user, ip);
  }

  @Delete(':id')
  @HttpCode(204)
  @Roles(Role.SYSTEM_ADMIN)
  async remove(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthUser, @ClientIp() ip: string | null) {
    await this.workers.remove(id, user, ip);
  }

  @Put(':id/photo')
  @Roles(Role.SYSTEM_ADMIN, Role.MANAGER)
  @ApiConsumes('multipart/form-data')
  @ApiBody({ schema: { type: 'object', properties: { file: { type: 'string', format: 'binary' } } } })
  @UseInterceptors(FileInterceptor('file', imageUploadOptions(DEFAULT_MAX_UPLOAD_BYTES)))
  setPhoto(
    @Param('id', ParseUUIDPipe) id: string,
    @UploadedFile() file: Express.Multer.File | undefined,
    @CurrentUser() user: AuthUser,
    @ClientIp() ip: string | null,
  ) {
    if (!file) throw new AppException('INVALID_IMAGE');
    return this.workers.setPhoto(id, file.buffer, user, ip);
  }

  /** Authenticated photo retrieval (never a public URL). A worker may only fetch their own. */
  @Get(':id/photo')
  @Roles(Role.SYSTEM_ADMIN, Role.MANAGER, Role.WORKER)
  async photo(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthUser, @Res() res: Response) {
    if (user.role === Role.WORKER && user.id !== id) throw new AppException('FORBIDDEN');
    const photo = await this.workers.getPhoto(id);
    res.setHeader('Content-Type', photo.mime);
    res.setHeader('Cache-Control', 'private, max-age=86400');
    res.setHeader('ETag', `"${photo.etag}"`);
    res.send(photo.data);
  }
}
