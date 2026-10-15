import { Controller, Get, Inject, Param, Post, Query, Req, Res, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiParam, ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';

import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import type { RateLimiter } from '../auth/rate-limiter';
import { apiFehler } from '../common/http-error';
import type { Membership } from '../tenancy/membership';
import { OrgGuard } from '../tenancy/org.guard';
import { PermissionGuard } from '../tenancy/require-permission';
import { CurrentMembership, CurrentUserId } from '../tenancy/request-context';

import { CalendarService } from './calendar.service';
import { ICAL_RATE_LIMITER } from './calendar.tokens';

/** iCal-Abonnement ohne Anmeldung: Der Token in der Adresse ist der Zugang (Ersatz der Edge Function ical-export). */
@ApiTags('calendar')
@Controller('public')
export class IcalController {
  constructor(
    private readonly kalender: CalendarService,
    @Inject(ICAL_RATE_LIMITER) private readonly limiter: RateLimiter
  ) {}

  @Get('ical')
  async abo(
    @Req() req: Request,
    @Res() res: Response,
    @Query('token') token?: string,
    @Query('org') org?: string,
    @Query('ag') ag?: string,
    @Query('download') download?: string
  ): Promise<void> {
    if (!(await this.limiter.consume(`ical:${req.ip ?? ''}`)).allowed) throw apiFehler(429, 'rate_limited', 'Zu viele Abrufe');
    const { name, ics, privat } = await this.kalender.abo({ token: token || undefined, org: org || undefined, ag: ag || undefined });
    res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
    res.setHeader('Cache-Control', privat ? 'private, no-store' : 'public, max-age=300');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    if (download !== 'false') res.setHeader('Content-Disposition', `attachment; filename="${name.replace(/[^a-zA-Z0-9._-]+/g, '_')}.ics"`);
    res.send(ics);
  }
}

@ApiTags('calendar')
@ApiBearerAuth()
@ApiParam({ name: 'orgId', format: 'uuid' })
@Controller('orgs/:orgId/calendar')
@UseGuards(JwtAuthGuard, OrgGuard, PermissionGuard)
export class CalendarTokenController {
  constructor(private readonly kalender: CalendarService) {}

  @Post('token')
  tokenErneuern(@CurrentUserId() userId: string, @Param('orgId') orgId: string, @CurrentMembership() aufrufer: Membership) {
    return this.kalender.tokenErneuern(userId, orgId, aufrufer);
  }
}
