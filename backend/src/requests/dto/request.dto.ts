import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { RecipientStatus, TargetType } from '@prisma/client';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsDateString,
  IsEnum,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { PaginationQueryDto } from '../../common/dto/pagination.dto';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : value);
const IDEMPOTENCY = /^[A-Za-z0-9-]{8,64}$/;

export class CreateRequestDto {
  @ApiProperty({ description: 'Client-generated UUID; resending the same key returns the same request' })
  @IsString()
  @Matches(IDEMPOTENCY)
  idempotencyKey: string;

  @ApiProperty({ example: 'إحضار المستندات' })
  @Transform(trim)
  @IsString()
  @MinLength(2, { message: 'عنوان الطلب مطلوب' })
  @MaxLength(200, { message: 'عنوان الطلب طويل جدًا' })
  title: string;

  @ApiProperty({ enum: TargetType })
  @IsEnum(TargetType)
  targetType: TargetType;

  @ApiPropertyOptional({ type: [String], description: 'Required for SINGLE (exactly 1) and MULTIPLE (≥1)' })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(500)
  @IsUUID('4', { each: true })
  workerIds?: string[];

  @ApiPropertyOptional({ type: [String], description: '0–3 previously uploaded attachment ids, in display order' })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(3, { message: 'الحد الأقصى 3 صور للطلب الواحد' })
  @IsUUID('4', { each: true })
  attachmentIds?: string[];
}

export class UpdateRequestDto {
  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MinLength(2, { message: 'عنوان الطلب مطلوب' })
  @MaxLength(200, { message: 'عنوان الطلب طويل جدًا' })
  title?: string;

  @ApiPropertyOptional({ type: [String], description: 'Full replacement list of attachment ids (0–3)' })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(3, { message: 'الحد الأقصى 3 صور للطلب الواحد' })
  @IsUUID('4', { each: true })
  attachmentIds?: string[];
}

export class ResendRequestDto {
  @ApiProperty()
  @IsString()
  @Matches(IDEMPOTENCY)
  idempotencyKey: string;
}

export class ReopenRequestDto {
  @ApiPropertyOptional({ type: [String], description: 'Recipients to reopen; default: all completed recipients' })
  @IsOptional()
  @IsArray()
  @IsUUID('4', { each: true })
  recipientIds?: string[];
}

export const REQUEST_STATUS_FILTERS = ['NEW', 'ACKNOWLEDGED', 'COMPLETED', 'CANCELLED'] as const;

export class ListRequestsQuery extends PaginationQueryDto {
  @ApiPropertyOptional({ description: 'Search in title or #number' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  q?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID('4')
  workerId?: string;

  @ApiPropertyOptional({ description: 'System admin only' })
  @IsOptional()
  @IsUUID('4')
  managerId?: string;

  @ApiPropertyOptional({ enum: REQUEST_STATUS_FILTERS })
  @IsOptional()
  @IsIn(REQUEST_STATUS_FILTERS)
  status?: RecipientStatus;

  @ApiPropertyOptional({ description: 'ISO date/time (inclusive)' })
  @IsOptional()
  @IsDateString()
  from?: string;

  @ApiPropertyOptional({ description: 'ISO date/time (inclusive)' })
  @IsOptional()
  @IsDateString()
  to?: string;

  @ApiPropertyOptional({ enum: ['all', 'active'], default: 'all' })
  @IsOptional()
  @IsIn(['all', 'active'])
  view: 'all' | 'active' = 'all';
}

/** Worker actions. `baseStateVersion` = the recipient version the worker saw when acting (offline conflict detection). */
export class WorkerActionDto {
  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  baseStateVersion?: number;

  @ApiPropertyOptional({ description: 'When the worker pressed the button (informational only; server time is authoritative)' })
  @IsOptional()
  @IsDateString()
  clientActionAt?: string;

  @ApiPropertyOptional({ description: 'Client operation id (for logs / tracing)' })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  opId?: string;
}

export class WorkerListQuery {
  @ApiPropertyOptional({ description: 'Return only items changed after this server time (incremental sync)' })
  @IsOptional()
  @IsDateString()
  since?: string;
}
