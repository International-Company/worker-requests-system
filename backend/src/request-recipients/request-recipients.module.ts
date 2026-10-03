import { Module } from '@nestjs/common';
import { RequestRecipientsController } from './request-recipients.controller';
import { RequestRecipientsService } from './request-recipients.service';

@Module({
  controllers: [RequestRecipientsController],
  providers: [RequestRecipientsService],
})
export class RequestRecipientsModule {}
