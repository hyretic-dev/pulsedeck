import { Body, Controller, Get, HttpCode, Inject, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiParam, ApiTags } from '@nestjs/swagger';
import type { Pool } from 'pg';

import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import type { RateLimiter } from '../auth/rate-limiter';
import { apiFehler } from '../common/http-error';
import { OrgGuard } from '../tenancy/org.guard';
import { PermissionGuard, RequireAdmin } from '../tenancy/require-permission';
import { CurrentUserId } from '../tenancy/request-context';

import { TestMailDto, UpdateNewsletterConfigDto } from './dto/newsletter.dto';
import { NewsletterService } from './newsletter.service';
import { NEWSLETTER_RATE_LIMITER } from './newsletter.tokens';

@ApiTags('newsletter')
@ApiBearerAuth()
@ApiParam({ name: 'orgId', format: 'uuid' })
@Controller('orgs/:orgId/newsletter')
@UseGuards(JwtAuthGuard, OrgGuard, PermissionGuard)
@RequireAdmin()
export class NewsletterController {
  constructor(
    private readonly newsletter: NewsletterService,
    @Inject(NEWSLETTER_RATE_LIMITER) private readonly limiter: RateLimiter
  ) {}

  @Get('config')
  konfiguration(@Param('orgId') orgId: string) {
    return this.newsletter.konfiguration(orgId);
  }

  @Patch('config')
  aktualisieren(@CurrentUserId() userId: string, @Param('orgId') orgId: string, @Body() dto: UpdateNewsletterConfigDto) {
    return this.newsletter.aktualisieren(userId, orgId, { ...dto });
  }

  @Post('test')
  @HttpCode(200)
  async testen(@Param('orgId') orgId: string, @Body() dto: TestMailDto) {
    if (!(await this.limiter.consume(`newsletter-test:${orgId}`)).allowed) throw apiFehler(429, 'rate_limited', 'Zu viele Testmails; bitte später erneut versuchen');
    return this.newsletter.testen(orgId, dto.email);
  }

  @Post('send')
  @HttpCode(200)
  senden(@CurrentUserId() userId: string, @Param('orgId') orgId: string) {
    return this.newsletter.versenden(userId, orgId, { erzwingen: true });
  }
}
