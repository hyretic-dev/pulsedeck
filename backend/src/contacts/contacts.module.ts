import { Module } from '@nestjs/common';

import { TenancyModule } from '../tenancy/tenancy.module';

import { ContactsController } from './contacts.controller';
import { ContactsService } from './contacts.service';

@Module({
  imports: [TenancyModule],
  controllers: [ContactsController],
  providers: [ContactsService],
})
export class ContactsModule {}
