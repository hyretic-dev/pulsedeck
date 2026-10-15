import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';

import { JwtAuthGuard } from '../auth/jwt-auth.guard';

import { AuditService } from './audit.service';
import { PageQuery, UpdateFeedbackDto } from './dto/activity.dto';
import { PlatformAdminGuard } from './platform-admin.guard';
import { TelemetryService } from './telemetry.service';

/** Plattformweite Sicht für Plattformadministratoren (`auth_users.is_platform_admin`): Protokoll, Analytics, Feedback, Online-Nutzer. */
@ApiTags('platform')
@ApiBearerAuth()
@Controller('platform')
@UseGuards(JwtAuthGuard, PlatformAdminGuard)
export class PlatformController {
  constructor(
    private readonly audit: AuditService,
    private readonly telemetrie: TelemetryService
  ) {}

  @Get('organizations')
  organisationen() {
    return this.audit.organisationen();
  }

  @Get('audit-logs')
  protokoll(@Query() q: PageQuery) {
    return this.audit.liste({ orgId: q.org_id, table: q.table, limit: q.limit, offset: q.offset });
  }

  @Get('analytics/stats')
  ereignisse(@Query() q: PageQuery) {
    return this.telemetrie.ereignisStatistik(q.org_id ?? null);
  }

  @Get('feedback')
  feedback(@Query() q: PageQuery) {
    return this.telemetrie.feedbackListe(q.org_id ?? null, q);
  }

  @Patch('feedback/:feedbackId')
  feedbackStatus(@Param('feedbackId', ParseUUIDPipe) feedbackId: string, @Body() dto: UpdateFeedbackDto) {
    return this.telemetrie.feedbackStatus(null, feedbackId, dto.status);
  }

  @Get('online-users')
  online(@Query() q: PageQuery) {
    return this.telemetrie.online(q.org_id ?? null);
  }
}
