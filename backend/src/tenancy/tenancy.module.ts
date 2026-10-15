import { Module } from '@nestjs/common';
import type { Pool } from 'pg';

import { AuthCoreModule } from '../auth/auth-core.module';
import { PG_POOL } from '../infrastructure/postgres/pg.pool';
import { PgMemberLinker } from '../infrastructure/postgres/pg.member-linker';
import { PgMembershipRepository } from '../infrastructure/postgres/pg.membership-repository';

import { MeController } from './me.controller';
import { OrgController } from './org.controller';
import { OrgGuard } from './org.guard';
import { PermissionGuard } from './require-permission';
import { MEMBER_LINKER, MEMBERSHIP_REPOSITORY } from './tenancy.tokens';

/** Mandantenkontext: Mitgliedschaften, OrgGuard und Rechteprüfung für alle Fachmodule. */
@Module({
  imports: [AuthCoreModule],
  controllers: [MeController, OrgController],
  providers: [
    {
      provide: MEMBERSHIP_REPOSITORY,
      useFactory: (pool: Pool) => new PgMembershipRepository(pool),
      inject: [PG_POOL],
    },
    {
      provide: MEMBER_LINKER,
      useFactory: (pool: Pool) => new PgMemberLinker(pool),
      inject: [PG_POOL],
    },
    OrgGuard,
    PermissionGuard,
  ],
  exports: [MEMBERSHIP_REPOSITORY, MEMBER_LINKER, OrgGuard, PermissionGuard, AuthCoreModule],
})
export class TenancyModule {}
