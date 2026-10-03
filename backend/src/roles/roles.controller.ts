import { Controller, Get } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { Roles } from '../common/auth/decorators';
import { ROLE_DEFINITIONS } from './roles';

@ApiTags('roles')
@Controller('roles')
export class RolesController {
  @Get()
  @Roles(Role.SYSTEM_ADMIN)
  list() {
    return Object.entries(ROLE_DEFINITIONS).map(([role, def]) => ({ role, ...def }));
  }
}
