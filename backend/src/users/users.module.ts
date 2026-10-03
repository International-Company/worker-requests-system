import { Global, Module } from '@nestjs/common';
import { PinService } from '../common/security/pin.service';
import { UsersService } from './users.service';

@Global()
@Module({
  providers: [UsersService, PinService],
  exports: [UsersService, PinService],
})
export class UsersModule {}
