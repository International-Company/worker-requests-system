import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';
import { Roles } from '../common/auth/decorators';
import { PaginationQueryDto } from '../common/dto/pagination.dto';
import { AuditService } from './audit.service';

class AuditQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(60)
  action?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(40)
  entityType?: string;
}

class LoginQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: Role })
  @IsOptional()
  @IsEnum(Role)
  role?: Role;
}

@ApiTags('logs')
@ApiBearerAuth()
@Roles(Role.SYSTEM_ADMIN)
@Controller('logs')
export class AuditController {
  constructor(private readonly audit: AuditService) {}

  @Get('audit')
  auditLogs(@Query() q: AuditQueryDto) {
    return this.audit.list(q);
  }

  @Get('logins')
  loginLogs(@Query() q: LoginQueryDto) {
    return this.audit.listLogins(q);
  }
}
