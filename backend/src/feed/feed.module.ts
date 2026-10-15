import { Module } from '@nestjs/common';

import { TenancyModule } from '../tenancy/tenancy.module';

import { FeedController } from './feed.controller';
import { FeedService } from './feed.service';

@Module({
  imports: [TenancyModule],
  controllers: [FeedController],
  providers: [FeedService],
  exports: [FeedService],
})
export class FeedModule {}
