import { Module } from '@nestjs/common';
import type { Pool } from 'pg';

import { PG_POOL } from '../infrastructure/postgres/pg.pool';
import { PgRateLimiter } from '../infrastructure/postgres/pg.rate-limiter';
import { TenancyModule } from '../tenancy/tenancy.module';

import { CalendarTokenController, IcalController } from './calendar.controller';
import { CalendarService } from './calendar.service';
import { ICAL_RATE_LIMITER } from './calendar.tokens';

@Module({
  imports: [TenancyModule],
  controllers: [IcalController, CalendarTokenController],
  providers: [CalendarService, { provide: ICAL_RATE_LIMITER, useFactory: (pool: Pool) => new PgRateLimiter(pool, { max: 120, windowMs: 60 * 1000 }), inject: [PG_POOL] }],
})
export class CalendarModule {}
