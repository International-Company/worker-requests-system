import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { Transform } from 'class-transformer';
import { IsBoolean, IsIn, IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);
export const STAFF_ROLES = [Role.MANAGER, Role.SYSTEM_ADMIN] as const;
export type StaffRole = (typeof STAFF_ROLES)[number];

export class CreateManagerDto {
  @ApiProperty({ example: 'محمد' })
  @Transform(trim)
  @IsString()
  @MinLength(2, { message: 'الاسم قصير جدًا' })
  @MaxLength(120)
  name: string;

  @ApiProperty({ example: '7310' })
  @IsString()
  @Matches(/^\d{4}$/, { message: 'رمز الدخول يجب أن يتكون من 4 أرقام' })
  pin: string;

  @ApiPropertyOptional({ enum: STAFF_ROLES, default: Role.MANAGER })
  @IsOptional()
  @IsIn(STAFF_ROLES)
  role?: StaffRole;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class UpdateManagerDto {
  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MinLength(2, { message: 'الاسم قصير جدًا' })
  @MaxLength(120)
  name?: string;

  @ApiPropertyOptional({ enum: STAFF_ROLES })
  @IsOptional()
  @IsIn(STAFF_ROLES)
  role?: StaffRole;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
