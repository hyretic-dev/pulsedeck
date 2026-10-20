import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';

import { JwtAuthGuard } from '../auth/jwt-auth.guard';

import { AuditService } from './audit.service';
import { CreateBoardEntryDto, PageQuery, ReplyFeedbackDto, UpdateBoardEntryDto } from './dto/activity.dto';
import { FeedbackBoardService } from './feedback-board.service';
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
    private readonly telemetrie: TelemetryService,
    private readonly board: FeedbackBoardService
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
    return this.board.liste({ orgId: q.org_id, limit: q.limit, offset: q.offset });
  }

  /** Themen nach Zahl der Organisationen (Bau-Regel). Vor `feedback/:feedbackId`, damit „topics“ nicht als ID gilt. */
  @Get('feedback/topics')
  themen() {
    return this.board.themen();
  }

  @Post('feedback')
  eintragen(@Body() dto: CreateBoardEntryDto) {
    return this.board.anlegen(dto);
  }

  @Patch('feedback/:feedbackId')
  feedbackAendern(@Param('feedbackId', ParseUUIDPipe) feedbackId: string, @Body() dto: UpdateBoardEntryDto) {
    return this.board.aendern(feedbackId, dto);
  }

  @Post('feedback/:feedbackId/reply')
  antworten(@Param('feedbackId', ParseUUIDPipe) feedbackId: string, @Body() dto: ReplyFeedbackDto) {
    return this.board.antworten(feedbackId, { text: dto.text, senden: dto.send ?? true });
  }

  @Get('online-users')
  online(@Query() q: PageQuery) {
    return this.telemetrie.online(q.org_id ?? null);
  }
}
