import { Body, Controller, Delete, Get, HttpCode, Inject, Param, ParseEnumPipe, ParseUUIDPipe, Patch, Post, Put, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiParam, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';

import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import type { RateLimiter } from '../auth/rate-limiter';
import { apiFehler } from '../common/http-error';
import type { Membership } from '../tenancy/membership';
import { OrgGuard } from '../tenancy/org.guard';
import { PermissionGuard, RequireAdmin, RequirePermission } from '../tenancy/require-permission';
import { CurrentMembership, CurrentUserId } from '../tenancy/request-context';

import { AuditService } from './audit.service';
import { DashboardService } from './dashboard.service';
import { CreateTaskDto, ONBOARDING_SCHRITTE, PageQuery, PresenceDto, SubmitFeedbackDto, TrackEventDto, UpdateFeedbackDto, UpdateTaskDto } from './dto/activity.dto';
import { OnboardingService } from './onboarding.service';
import { OptionalJwtGuard } from './optional-jwt.guard';
import { TelemetryService } from './telemetry.service';
import { ANALYTICS_RATE_LIMITER, FEEDBACK_RATE_LIMITER } from './activity.tokens';

const SCHRITT_PIPE = new ParseEnumPipe(Object.fromEntries(ONBOARDING_SCHRITTE.map((s) => [s, s])));

/** Ohne Organisationsbezug: Analytics-Ereignisse, Feedback (auch anonym) und Anwesenheit. */
@ApiTags('activity')
@Controller()
export class TelemetryController {
  constructor(
    private readonly telemetrie: TelemetryService,
    @Inject(ANALYTICS_RATE_LIMITER) private readonly analyticsLimiter: RateLimiter,
    @Inject(FEEDBACK_RATE_LIMITER) private readonly feedbackLimiter: RateLimiter
  ) {}

  @Post('analytics/events')
  @UseGuards(OptionalJwtGuard)
  @HttpCode(204)
  async ereignis(@Req() req: Request & { userId?: string }, @Body() dto: TrackEventDto): Promise<void> {
    if (!(await this.analyticsLimiter.consume(`analytics:${req.userId ?? req.ip ?? ''}`)).allowed) throw apiFehler(429, 'rate_limited', 'Zu viele Anfragen');
    await this.telemetrie.ereignis(req.userId, { ...dto });
  }

  @Post('feedback')
  @UseGuards(OptionalJwtGuard)
  @HttpCode(204)
  async feedback(@Req() req: Request & { userId?: string }, @Body() dto: SubmitFeedbackDto): Promise<void> {
    if (!(await this.feedbackLimiter.consume(`feedback:${req.userId ?? req.ip ?? ''}`)).allowed) throw apiFehler(429, 'rate_limited', 'Zu viele Rückmeldungen; bitte später erneut versuchen');
    await this.telemetrie.feedbackEinreichen(req.userId, { ...dto });
  }

  @Post('presence')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @HttpCode(204)
  async anwesenheit(@CurrentUserId() userId: string, @Body() dto: PresenceDto): Promise<void> {
    await this.telemetrie.anwesenheit(userId, dto.current_path);
  }
}

@ApiTags('activity')
@ApiBearerAuth()
@ApiParam({ name: 'orgId', format: 'uuid' })
@Controller('orgs/:orgId')
@UseGuards(JwtAuthGuard, OrgGuard, PermissionGuard)
export class OrgActivityController {
  constructor(
    private readonly onboarding: OnboardingService,
    private readonly dashboard: DashboardService,
    private readonly telemetrie: TelemetryService,
    private readonly audit: AuditService
  ) {}

  @Get('onboarding')
  fortschritt(@CurrentMembership() aufrufer: Membership) {
    return this.onboarding.fortschritt(aufrufer);
  }

  @Put('onboarding/steps/:stepKey')
  @HttpCode(204)
  async schritt(@CurrentMembership() aufrufer: Membership, @Param('stepKey', SCHRITT_PIPE) stepKey: string): Promise<void> {
    await this.onboarding.schrittAbschliessen(aufrufer, stepKey);
  }

  @Get('tasks')
  aufgaben(@CurrentMembership() aufrufer: Membership) {
    return this.onboarding.aufgaben(aufrufer);
  }

  @Post('tasks')
  aufgabeAnlegen(@CurrentMembership() aufrufer: Membership, @Body() dto: CreateTaskDto) {
    return this.onboarding.aufgabeAnlegen(aufrufer, dto.title);
  }

  @Patch('tasks/:taskId')
  aufgabeAendern(@CurrentMembership() aufrufer: Membership, @Param('taskId', ParseUUIDPipe) taskId: string, @Body() dto: UpdateTaskDto) {
    return this.onboarding.aufgabeAendern(aufrufer, taskId, { ...dto });
  }

  @Delete('tasks/:taskId')
  @HttpCode(204)
  async aufgabeLoeschen(@CurrentMembership() aufrufer: Membership, @Param('taskId', ParseUUIDPipe) taskId: string): Promise<void> {
    await this.onboarding.aufgabeLoeschen(aufrufer, taskId);
  }

  @Get('statistics')
  statistik(@Param('orgId') orgId: string, @CurrentMembership() aufrufer: Membership) {
    return this.dashboard.statistik(orgId, aufrufer);
  }

  @Get('birthdays')
  geburtstage(@Param('orgId') orgId: string) {
    return this.dashboard.geburtstage(orgId);
  }

  @Get('audit-logs')
  @RequireAdmin()
  protokoll(@Param('orgId') orgId: string, @Query() q: PageQuery) {
    return this.audit.liste({ orgId, table: q.table, limit: q.limit, offset: q.offset });
  }

  @Get('analytics/stats')
  @RequireAdmin()
  statistikEreignisse(@Param('orgId') orgId: string) {
    return this.telemetrie.ereignisStatistik(orgId);
  }

  @Get('analytics/events')
  @RequireAdmin()
  letzteEreignisse(@Param('orgId') orgId: string, @Query() q: PageQuery) {
    return this.telemetrie.letzteEreignisse(orgId, q.limit);
  }

  @Get('feedback')
  @RequirePermission('view_issue_tracker')
  feedbackListe(@Param('orgId') orgId: string, @Query() q: PageQuery) {
    return this.telemetrie.feedbackListe(orgId, q);
  }

  @Patch('feedback/:feedbackId')
  @RequirePermission('view_issue_tracker')
  feedbackStatus(@Param('orgId') orgId: string, @Param('feedbackId', ParseUUIDPipe) feedbackId: string, @Body() dto: UpdateFeedbackDto) {
    return this.telemetrie.feedbackStatus(orgId, feedbackId, dto.status);
  }

  @Get('presence')
  @RequireAdmin()
  online(@Param('orgId') orgId: string) {
    return this.telemetrie.online(orgId);
  }
}
