import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiParam, ApiTags } from '@nestjs/swagger';
import { IsString, MaxLength } from 'class-validator';

import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import type { Membership } from '../tenancy/membership';
import { OrgGuard } from '../tenancy/org.guard';
import { PermissionGuard } from '../tenancy/require-permission';
import { CurrentMembership, CurrentUserId } from '../tenancy/request-context';

import { RespondGuestDto } from './dto/event.dto';
import { GuestsService } from './guests.service';

export class OrgSearchQuery {
  @IsString() @MaxLength(100) q!: string;
}

/** Sicht der eingeladenen Organisation sowie die Suche nach Gastorganisationen. */
@ApiTags('events')
@ApiBearerAuth()
@ApiParam({ name: 'orgId', format: 'uuid' })
@Controller('orgs/:orgId')
@UseGuards(JwtAuthGuard, OrgGuard, PermissionGuard)
export class GuestsController {
  constructor(private readonly gaeste: GuestsService) {}

  @Get('guest-organizations/search')
  suche(@Param('orgId') orgId: string, @CurrentMembership() aufrufer: Membership, @Query() query: OrgSearchQuery) {
    return this.gaeste.suche(orgId, aufrufer, query.q);
  }

  @Get('guest-invitations')
  offene(@Param('orgId') orgId: string, @CurrentMembership() aufrufer: Membership) {
    return this.gaeste.offeneEinladungen(orgId, aufrufer);
  }

  @Patch('guest-invitations/:invitationId')
  antworten(
    @CurrentUserId() userId: string,
    @CurrentMembership() aufrufer: Membership,
    @Param('orgId') orgId: string,
    @Param('invitationId', ParseUUIDPipe) invitationId: string,
    @Body() dto: RespondGuestDto
  ) {
    return this.gaeste.antworten(userId, orgId, aufrufer, invitationId, dto.status);
  }

  @Get('guest-events')
  gastTermine(@Param('orgId') orgId: string) {
    return this.gaeste.gastTermine(orgId);
  }
}
