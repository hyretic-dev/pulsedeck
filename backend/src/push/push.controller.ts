import { Body, Controller, Get, HttpCode, Param, Post, Put, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiParam, ApiTags } from '@nestjs/swagger';

import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import type { Membership } from '../tenancy/membership';
import { OrgGuard } from '../tenancy/org.guard';
import { PermissionGuard } from '../tenancy/require-permission';
import { CurrentMembership } from '../tenancy/request-context';

import { PushSubscriptionDto, PushUnsubscribeDto } from './dto/push.dto';
import { PushService } from './push.service';

/** Öffentlicher Schlüssel für die Anmeldung beim Push-Dienst (anonym lesbar, enthält nichts Geheimes). */
@ApiTags('push')
@Controller('push')
export class PushConfigController {
  constructor(private readonly push: PushService) {}

  @Get('config')
  konfiguration() {
    return this.push.konfiguration();
  }
}

@ApiTags('push')
@ApiBearerAuth()
@ApiParam({ name: 'orgId', format: 'uuid' })
@Controller('orgs/:orgId/push')
@UseGuards(JwtAuthGuard, OrgGuard, PermissionGuard)
export class PushController {
  constructor(private readonly push: PushService) {}

  @Put('subscription')
  @HttpCode(204)
  async abonnieren(@CurrentMembership() aufrufer: Membership, @Param('orgId') _orgId: string, @Body() dto: PushSubscriptionDto): Promise<void> {
    await this.push.abonnieren(aufrufer, dto.endpoint, dto.keys);
  }

  @Post('unsubscribe')
  @HttpCode(204)
  async abbestellen(@CurrentMembership() aufrufer: Membership, @Param('orgId') _orgId: string, @Body() dto: PushUnsubscribeDto): Promise<void> {
    await this.push.abbestellen(aufrufer, dto.endpoint);
  }
}
