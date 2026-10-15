import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Put, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiParam, ApiTags } from '@nestjs/swagger';

import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import type { Membership } from '../tenancy/membership';
import { OrgGuard } from '../tenancy/org.guard';
import { PermissionGuard } from '../tenancy/require-permission';
import { CurrentMembership, CurrentUserId } from '../tenancy/request-context';

import { CreateEventDto, CreateSlotDto, InviteGuestDto, RegisterDto, RegistrationSummaryDto, UpdateEventDto } from './dto/event.dto';
import { EventsService } from './events.service';
import { GuestsService } from './guests.service';
import { SlotsService } from './slots.service';

@ApiTags('events')
@ApiBearerAuth()
@ApiParam({ name: 'orgId', format: 'uuid' })
@Controller('orgs/:orgId/events')
@UseGuards(JwtAuthGuard, OrgGuard, PermissionGuard)
export class EventsController {
  constructor(
    private readonly events: EventsService,
    private readonly slots: SlotsService,
    private readonly gaeste: GuestsService
  ) {}

  @Get()
  liste(@Param('orgId') orgId: string, @CurrentMembership() aufrufer: Membership) {
    return this.events.liste(orgId, aufrufer);
  }

  /** Kommende Termine der Arbeitsgruppen (AG-Übersicht). Vor `:eventId` registrieren. */
  @Get('working-group-upcoming')
  agTermine(@Param('orgId') orgId: string, @CurrentMembership() aufrufer: Membership) {
    return this.events.kommendeAgTermine(orgId, aufrufer);
  }

  @Get('registrations/mine')
  meineAnmeldungen(@Param('orgId') orgId: string, @CurrentMembership() aufrufer: Membership) {
    return this.events.meineAnmeldungen(orgId, aufrufer);
  }

  @Post('registrations/summary')
  @HttpCode(200)
  zusammenfassung(@Param('orgId') orgId: string, @CurrentMembership() aufrufer: Membership, @Body() dto: RegistrationSummaryDto) {
    return this.events.zusammenfassung(orgId, aufrufer, dto.event_ids);
  }

  @Post()
  anlegen(@CurrentUserId() userId: string, @CurrentMembership() aufrufer: Membership, @Param('orgId') orgId: string, @Body() dto: CreateEventDto) {
    const { ag_name: _ignoriert, ...eingabe } = dto;
    return this.events.anlegen(userId, orgId, aufrufer, eingabe);
  }

  @Get(':eventId')
  einzeln(@Param('orgId') orgId: string, @CurrentMembership() aufrufer: Membership, @Param('eventId', ParseUUIDPipe) eventId: string) {
    return this.events.einzeln(orgId, aufrufer, eventId);
  }

  @Patch(':eventId')
  aendern(
    @CurrentUserId() userId: string,
    @CurrentMembership() aufrufer: Membership,
    @Param('orgId') orgId: string,
    @Param('eventId', ParseUUIDPipe) eventId: string,
    @Body() dto: UpdateEventDto
  ) {
    const { ag_name: _ignoriert, ...eingabe } = dto;
    return this.events.aendern(userId, orgId, aufrufer, eventId, eingabe);
  }

  @Delete(':eventId')
  @HttpCode(204)
  async loeschen(
    @CurrentUserId() userId: string,
    @CurrentMembership() aufrufer: Membership,
    @Param('orgId') orgId: string,
    @Param('eventId', ParseUUIDPipe) eventId: string
  ): Promise<void> {
    await this.events.loeschen(userId, orgId, aufrufer, eventId);
  }

  // ── Anmeldungen ─────────────────────────────────────────────────────────────

  @Put(':eventId/registration')
  anmelden(
    @Param('orgId') orgId: string,
    @CurrentMembership() aufrufer: Membership,
    @Param('eventId', ParseUUIDPipe) eventId: string,
    @Body() dto: RegisterDto
  ) {
    return this.events.anmelden(orgId, aufrufer, eventId, dto.status ?? 'confirmed', dto.note);
  }

  @Delete(':eventId/registration')
  @HttpCode(204)
  async abmelden(@Param('orgId') orgId: string, @CurrentMembership() aufrufer: Membership, @Param('eventId', ParseUUIDPipe) eventId: string): Promise<void> {
    await this.events.abmelden(orgId, aufrufer, eventId);
  }

  @Get(':eventId/registrations')
  teilnehmer(@Param('orgId') orgId: string, @CurrentMembership() aufrufer: Membership, @Param('eventId', ParseUUIDPipe) eventId: string) {
    return this.events.teilnehmer(orgId, aufrufer, eventId);
  }

  // ── Helferslots ─────────────────────────────────────────────────────────────

  @Get(':eventId/slots')
  slotListe(@Param('orgId') orgId: string, @CurrentMembership() aufrufer: Membership, @Param('eventId', ParseUUIDPipe) eventId: string) {
    return this.slots.liste(orgId, aufrufer, eventId);
  }

  @Post(':eventId/slots')
  slotAnlegen(
    @Param('orgId') orgId: string,
    @CurrentMembership() aufrufer: Membership,
    @Param('eventId', ParseUUIDPipe) eventId: string,
    @Body() dto: CreateSlotDto
  ) {
    return this.slots.anlegen(orgId, aufrufer, eventId, { ...dto });
  }

  // ── Gastorganisationen ──────────────────────────────────────────────────────

  @Get(':eventId/guests')
  gaesteListe(@Param('orgId') orgId: string, @CurrentMembership() aufrufer: Membership, @Param('eventId', ParseUUIDPipe) eventId: string) {
    return this.gaeste.liste(orgId, aufrufer, eventId);
  }

  @Post(':eventId/guests')
  gastEinladen(
    @CurrentUserId() userId: string,
    @CurrentMembership() aufrufer: Membership,
    @Param('orgId') orgId: string,
    @Param('eventId', ParseUUIDPipe) eventId: string,
    @Body() dto: InviteGuestDto
  ) {
    return this.gaeste.einladen(userId, orgId, aufrufer, eventId, { ...dto });
  }

  @Delete(':eventId/guests/:guestId')
  @HttpCode(204)
  async gastEntfernen(
    @CurrentUserId() userId: string,
    @CurrentMembership() aufrufer: Membership,
    @Param('orgId') orgId: string,
    @Param('eventId', ParseUUIDPipe) eventId: string,
    @Param('guestId', ParseUUIDPipe) guestId: string
  ): Promise<void> {
    await this.gaeste.entfernen(userId, orgId, aufrufer, eventId, guestId);
  }
}
