import { Module } from '@nestjs/common';

import { TenancyModule } from '../tenancy/tenancy.module';

import { WorkingGroupsController } from './working-groups.controller';
import { WorkingGroupsService } from './working-groups.service';

@Module({
  imports: [TenancyModule],
  controllers: [WorkingGroupsController],
  providers: [WorkingGroupsService],
  exports: [WorkingGroupsService],
})
export class WorkingGroupsModule {}
