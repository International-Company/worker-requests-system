import { Module } from '@nestjs/common';
import { ManagersController } from './managers.controller';
import { ManagersService } from './managers.service';

@Module({
  controllers: [ManagersController],
  providers: [ManagersService],
})
export class ManagersModule {}
