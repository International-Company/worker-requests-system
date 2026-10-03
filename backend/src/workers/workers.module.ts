import { Module } from '@nestjs/common';
import { AttachmentsModule } from '../attachments/attachments.module';
import { WorkersController } from './workers.controller';
import { WorkersService } from './workers.service';

@Module({
  imports: [AttachmentsModule],
  controllers: [WorkersController],
  providers: [WorkersService],
})
export class WorkersModule {}
