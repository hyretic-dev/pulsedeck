import { Module } from '@nestjs/common';

import { TenancyModule } from '../tenancy/tenancy.module';

import { OrganizationsController, PublicOrganizationsController } from './organizations.controller';
import { OrganizationsService } from './organizations.service';

@Module({
  imports: [TenancyModule],
  controllers: [OrganizationsController, PublicOrganizationsController],
  providers: [OrganizationsService],
  exports: [OrganizationsService],
})
export class OrganizationsModule {}
