import { Module } from '@nestjs/common';
import type { Pool } from 'pg';

import { PG_POOL } from '../infrastructure/postgres/pg.pool';
import { PgRateLimiter } from '../infrastructure/postgres/pg.rate-limiter';
import { TenancyModule } from '../tenancy/tenancy.module';

import { ANALYTICS_RATE_LIMITER, FEEDBACK_RATE_LIMITER } from './activity.tokens';
import { OrgActivityController, TelemetryController } from './activity.controller';
import { AuditService } from './audit.service';
import { DashboardService } from './dashboard.service';
import { FeedbackBoardService } from './feedback-board.service';
import { OnboardingService } from './onboarding.service';
import { OptionalJwtGuard } from './optional-jwt.guard';
import { PlatformAdminGuard } from './platform-admin.guard';
import { PlatformController } from './platform.controller';
import { TelemetryService } from './telemetry.service';

@Module({
  imports: [TenancyModule],
  controllers: [TelemetryController, OrgActivityController, PlatformController],
  providers: [
    OnboardingService,
    DashboardService,
    TelemetryService,
    AuditService,
    FeedbackBoardService,
    OptionalJwtGuard,
    PlatformAdminGuard,
    { provide: ANALYTICS_RATE_LIMITER, useFactory: (pool: Pool) => new PgRateLimiter(pool, { max: 120, windowMs: 60 * 1000 }), inject: [PG_POOL] },
    { provide: FEEDBACK_RATE_LIMITER, useFactory: (pool: Pool) => new PgRateLimiter(pool, { max: 10, windowMs: 60 * 60 * 1000 }), inject: [PG_POOL] },
  ],
})
export class ActivityModule {}
