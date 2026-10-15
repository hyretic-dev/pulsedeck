import { Module } from '@nestjs/common';
import type { Pool } from 'pg';

import { PG_POOL } from '../infrastructure/postgres/pg.pool';
import { PgRateLimiter } from '../infrastructure/postgres/pg.rate-limiter';
import { TenancyModule } from '../tenancy/tenancy.module';

import { NewsletterController } from './newsletter.controller';
import { NewsletterService } from './newsletter.service';
import { NEWSLETTER_RATE_LIMITER } from './newsletter.tokens';

@Module({
  imports: [TenancyModule],
  controllers: [NewsletterController],
  providers: [
    NewsletterService,
    { provide: NEWSLETTER_RATE_LIMITER, useFactory: (pool: Pool) => new PgRateLimiter(pool, { max: 10, windowMs: 60 * 60 * 1000 }), inject: [PG_POOL] },
  ],
  exports: [NewsletterService],
})
export class NewsletterModule {}
