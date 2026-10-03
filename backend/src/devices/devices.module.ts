import { Global, Module } from '@nestjs/common';
import { DevicesService } from './devices.service';
import { PushSubscriptionsController } from './push-subscriptions.controller';

@Global()
@Module({
  controllers: [PushSubscriptionsController],
  providers: [DevicesService],
  exports: [DevicesService],
})
export class DevicesModule {}
