import { Global, Module } from '@nestjs/common';
import { PUSH_PROVIDER } from './push.types';
import { WebPushProvider } from './web-push.provider';

@Global()
@Module({
  providers: [{ provide: PUSH_PROVIDER, useClass: WebPushProvider }],
  exports: [PUSH_PROVIDER],
})
export class PushModule {}
