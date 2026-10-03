import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query, Req, Res, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBody, ApiConsumes, ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { IsIn, IsOptional, IsString, Matches } from 'class-validator';
import type { Request, Response } from 'express';
import { AuthUser } from '../common/auth/auth-user';
import { CurrentUser, Roles } from '../common/auth/decorators';
import { AppException } from '../common/errors/app.exception';
import { DEFAULT_MAX_UPLOAD_BYTES, imageUploadOptions } from '../common/upload/image-upload.options';
import { AttachmentsService } from './attachments.service';

class UploadDto {
  @ApiProperty({ description: 'Client-generated id (UUID) — retrying with the same id is safe' })
  @IsString()
  @Matches(/^[A-Za-z0-9-]{8,64}$/)
  clientUploadId: string;
}

class ReadQuery {
  @ApiPropertyOptional({ enum: ['full', 'thumb'], default: 'full' })
  @IsOptional()
  @IsIn(['full', 'thumb'])
  variant: 'full' | 'thumb' = 'full';
}

@ApiTags('attachments')
@Controller('attachments')
export class AttachmentsController {
  constructor(private readonly attachments: AttachmentsService) {}

  @Post()
  @Roles(Role.MANAGER)
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: { file: { type: 'string', format: 'binary' }, clientUploadId: { type: 'string' } },
    },
  })
  @UseInterceptors(FileInterceptor('file', imageUploadOptions(DEFAULT_MAX_UPLOAD_BYTES)))
  upload(@UploadedFile() file: Express.Multer.File | undefined, @Body() dto: UploadDto, @CurrentUser() user: AuthUser) {
    if (!file) throw new AppException('INVALID_IMAGE');
    return this.attachments.upload(file.buffer, dto.clientUploadId, user);
  }

  /** Authenticated image retrieval (session cookie). Never exposed via a public URL. */
  @Get(':id')
  @Roles(Role.SYSTEM_ADMIN, Role.MANAGER, Role.WORKER)
  async read(
    @Param('id', ParseUUIDPipe) id: string,
    @Query() q: ReadQuery,
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    const img = await this.attachments.read(id, q.variant, user);
    const etag = `"${img.etag}"`;
    // Private: may be cached by this browser (offline viewing) but never by shared caches.
    res.setHeader('Cache-Control', 'private, max-age=604800, immutable');
    res.setHeader('ETag', etag);
    if (req.headers['if-none-match'] === etag) {
      res.status(304).end();
      return;
    }
    res.setHeader('Content-Type', img.mime);
    res.send(img.data);
  }
}
