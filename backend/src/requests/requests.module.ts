import { Module } from '@nestjs/common';
import { AttachmentsModule } from '../attachments/attachments.module';
import { RequestsController } from './requests.controller';
import { RequestsService } from './requests.service';

@Module({
  imports: [AttachmentsModule],
  controllers: [RequestsController],
  providers: [RequestsService],
})
export class RequestsModule {}
