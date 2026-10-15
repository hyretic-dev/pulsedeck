import { Module } from '@nestjs/common';

import { TenancyModule } from '../tenancy/tenancy.module';

import { RealtimeController } from './realtime.controller';
import { RealtimeService } from './realtime.service';

@Module({
  imports: [TenancyModule],
  controllers: [RealtimeController],
  providers: [RealtimeService],
})
export class RealtimeModule {}
