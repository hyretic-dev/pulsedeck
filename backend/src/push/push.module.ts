import { Module } from '@nestjs/common';

import { APP_CONFIG, type AppConfig } from '../config/configuration';
import { TenancyModule } from '../tenancy/tenancy.module';

import { PushConfigController, PushController } from './push.controller';
import { PUSH_SENDER, WebPushSender } from './push-sender';
import { PushService } from './push.service';

@Module({
  imports: [TenancyModule],
  controllers: [PushConfigController, PushController],
  providers: [
    { provide: PUSH_SENDER, useFactory: (config: AppConfig) => (config.push ? new WebPushSender(config.push) : null), inject: [APP_CONFIG] },
    PushService,
  ],
  exports: [PushService],
})
export class PushModule {}
