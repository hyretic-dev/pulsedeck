import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module';
import { TenancyModule } from '../tenancy/tenancy.module';

import { MembersController } from './members.controller';
import { MembersService } from './members.service';
import { RolesService } from './roles.service';

@Module({
  imports: [AuthModule, TenancyModule],
  controllers: [MembersController],
  providers: [MembersService, RolesService],
  exports: [MembersService],
})
export class MembersModule {}
