import { Module } from '@nestjs/common';
import { AttachmentsController } from './attachments.controller';
import { AttachmentsService } from './attachments.service';
import { ImageProcessorService } from './image-processor.service';

@Module({
  controllers: [AttachmentsController],
  providers: [AttachmentsService, ImageProcessorService],
  exports: [AttachmentsService, ImageProcessorService],
})
export class AttachmentsModule {}
