import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsBoolean, IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

export class CreateWorkerDto {
  @ApiProperty({ example: 'أحمد علي' })
  @Transform(trim)
  @IsString()
  @MinLength(2, { message: 'اسم العامل قصير جدًا' })
  @MaxLength(120)
  name: string;

  @ApiProperty({ example: '0500000000' })
  @Transform(trim)
  @IsString()
  @Matches(/^\+?[0-9 -]{6,20}$/, { message: 'رقم الهاتف غير صحيح' })
  phone: string;

  @ApiProperty({ example: '4821' })
  @IsString()
  @Matches(/^\d{4}$/, { message: 'رمز الدخول يجب أن يتكون من 4 أرقام' })
  pin: string;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class UpdateWorkerDto {
  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MinLength(2, { message: 'اسم العامل قصير جدًا' })
  @MaxLength(120)
  name?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trim)
  @IsString()
  @Matches(/^\+?[0-9 -]{6,20}$/, { message: 'رقم الهاتف غير صحيح' })
  phone?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class ChangePinDto {
  @ApiProperty({ example: '4821' })
  @IsString()
  @Matches(/^\d{4}$/, { message: 'رمز الدخول يجب أن يتكون من 4 أرقام' })
  pin: string;
}
