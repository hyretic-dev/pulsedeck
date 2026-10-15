import { Module } from '@nestjs/common';

import { TenancyModule } from '../tenancy/tenancy.module';

import { WikiController } from './wiki.controller';
import { WikiService } from './wiki.service';

@Module({
  imports: [TenancyModule],
  controllers: [WikiController],
  providers: [WikiService],
})
export class WikiModule {}
