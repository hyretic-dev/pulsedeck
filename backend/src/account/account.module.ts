import { Module } from '@nestjs/common';

import { AuthCoreModule } from '../auth/auth-core.module';

import { AccountController } from './account.controller';
import { AccountService } from './account.service';

@Module({
  imports: [AuthCoreModule],
  controllers: [AccountController],
  providers: [AccountService],
})
export class AccountModule {}
