import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Put, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiParam, ApiTags } from '@nestjs/swagger';

import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import type { Membership } from '../tenancy/membership';
import { OrgGuard } from '../tenancy/org.guard';
import { PermissionGuard } from '../tenancy/require-permission';
import { CurrentMembership } from '../tenancy/request-context';

import { SlotSignupDto, UpdateSlotDto } from './dto/event.dto';
import { SlotsService } from './slots.service';

@ApiTags('events')
@ApiBearerAuth()
@ApiParam({ name: 'orgId', format: 'uuid' })
@Controller('orgs/:orgId')
@UseGuards(JwtAuthGuard, OrgGuard, PermissionGuard)
export class SlotsController {
  constructor(private readonly slots: SlotsService) {}

  /** Eigene Helfer-Anmeldungen. Vor `slots/:slotId` registrieren. */
  @Get('slots/signups/mine')
  meine(@Param('orgId') orgId: string, @CurrentMembership() aufrufer: Membership) {
    return this.slots.meineAnmeldungen(orgId, aufrufer);
  }

  /** Passende Einsatzmöglichkeiten (höchstens drei) für das eigene Mitglied. */
  @Get('matching/opportunities')
  chancen(@Param('orgId') orgId: string, @CurrentMembership() aufrufer: Membership) {
    return this.slots.chancen(orgId, aufrufer);
  }

  @Patch('slots/:slotId')
  aendern(
    @Param('orgId') orgId: string,
    @CurrentMembership() aufrufer: Membership,
    @Param('slotId', ParseUUIDPipe) slotId: string,
    @Body() dto: UpdateSlotDto
  ) {
    return this.slots.aendern(orgId, aufrufer, slotId, { ...dto });
  }

  @Delete('slots/:slotId')
  @HttpCode(204)
  async loeschen(@Param('orgId') orgId: string, @CurrentMembership() aufrufer: Membership, @Param('slotId', ParseUUIDPipe) slotId: string): Promise<void> {
    await this.slots.loeschen(orgId, aufrufer, slotId);
  }

  @Put('slots/:slotId/signup')
  anmelden(
    @Param('orgId') orgId: string,
    @CurrentMembership() aufrufer: Membership,
    @Param('slotId', ParseUUIDPipe) slotId: string,
    @Body() dto: SlotSignupDto
  ) {
    return this.slots.anmelden(orgId, aufrufer, slotId, dto.note);
  }

  @Delete('slots/:slotId/signup')
  @HttpCode(204)
  async abmelden(@Param('orgId') orgId: string, @CurrentMembership() aufrufer: Membership, @Param('slotId', ParseUUIDPipe) slotId: string): Promise<void> {
    await this.slots.abmelden(orgId, aufrufer, slotId);
  }
}
