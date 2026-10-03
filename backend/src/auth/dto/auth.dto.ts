import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, Matches, MaxLength } from 'class-validator';

export class LoginDto {
  @ApiProperty({ example: '1234', description: '4-digit PIN' })
  @IsString()
  @Matches(/^\d{4}$/, { message: 'رمز الدخول يجب أن يتكون من 4 أرقام' })
  pin: string;

  @ApiProperty({ description: 'Random id (UUID) generated once by this browser and kept in its storage' })
  @IsString()
  @Matches(/^[A-Za-z0-9-]{16,64}$/)
  deviceKey: string;

  @ApiPropertyOptional({ description: 'Human readable label, e.g. "Android · Chrome"' })
  @IsOptional()
  @IsString()
  @MaxLength(160)
  deviceLabel?: string;
}
