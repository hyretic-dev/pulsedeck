import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Put, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiParam, ApiTags } from '@nestjs/swagger';

import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import type { Membership } from '../tenancy/membership';
import { OrgGuard } from '../tenancy/org.guard';
import { PermissionGuard } from '../tenancy/require-permission';
import { CurrentMembership, CurrentUserId } from '../tenancy/request-context';

import { BookingsService } from './bookings.service';
import { CalendarsService } from './calendars.service';
import {
  AvailabilityQueryDto, CreateBookingDto, CreateCalendarDto, DeclineBookingDto, EndSeriesDto, RangeQueryDto, RenameSeriesDto,
  SeriesDto, SetCalendarMemberDto, UpdateBookingDto, UpdateCalendarDto,
} from './dto/booking.dto';
import { SeriesService } from './series.service';

@ApiTags('bookings')
@ApiBearerAuth()
@ApiParam({ name: 'orgId', format: 'uuid' })
@Controller('orgs/:orgId')
@UseGuards(JwtAuthGuard, OrgGuard, PermissionGuard)
export class BookingsController {
  constructor(
    private readonly plaene: CalendarsService,
    private readonly buchungen: BookingsService,
    private readonly serien: SeriesService
  ) {}

  // ── Pläne ───────────────────────────────────────────────────────────────────

  @Get('booking-calendars')
  liste(@Param('orgId') orgId: string, @CurrentMembership() aufrufer: Membership) {
    return this.plaene.liste(orgId, aufrufer);
  }

  /** Vor `:calId` registrieren. */
  @Get('booking-calendars/open-requests')
  offeneAnfragen(@Param('orgId') orgId: string, @CurrentMembership() aufrufer: Membership) {
    return this.plaene.offeneAnfragen(orgId, aufrufer);
  }

  @Post('booking-calendars')
  anlegen(@CurrentUserId() userId: string, @Param('orgId') orgId: string, @CurrentMembership() aufrufer: Membership, @Body() dto: CreateCalendarDto) {
    return this.plaene.anlegen(userId, orgId, aufrufer, dto);
  }

  @Get('booking-calendars/:calId')
  einzeln(@Param('orgId') orgId: string, @Param('calId', ParseUUIDPipe) calId: string, @CurrentMembership() aufrufer: Membership) {
    return this.plaene.einzeln(orgId, calId, aufrufer);
  }

  @Patch('booking-calendars/:calId')
  aendern(
    @CurrentUserId() userId: string, @Param('orgId') orgId: string, @Param('calId', ParseUUIDPipe) calId: string,
    @CurrentMembership() aufrufer: Membership, @Body() dto: UpdateCalendarDto
  ) {
    return this.plaene.aendern(userId, orgId, calId, aufrufer, dto);
  }

  @Delete('booking-calendars/:calId')
  @HttpCode(204)
  async loeschen(@CurrentUserId() userId: string, @Param('orgId') orgId: string, @Param('calId', ParseUUIDPipe) calId: string, @CurrentMembership() aufrufer: Membership): Promise<void> {
    await this.plaene.loeschen(userId, orgId, calId, aufrufer);
  }

  // ── Rollen im Plan ──────────────────────────────────────────────────────────

  @Get('booking-calendars/:calId/members')
  mitglieder(@Param('orgId') orgId: string, @Param('calId', ParseUUIDPipe) calId: string, @CurrentMembership() aufrufer: Membership) {
    return this.plaene.mitglieder(orgId, calId, aufrufer);
  }

  @Put('booking-calendars/:calId/members/:memberId')
  setzeMitglied(
    @CurrentUserId() userId: string, @Param('orgId') orgId: string, @Param('calId', ParseUUIDPipe) calId: string,
    @Param('memberId', ParseUUIDPipe) memberId: string, @CurrentMembership() aufrufer: Membership, @Body() dto: SetCalendarMemberDto
  ) {
    return this.plaene.setzeMitglied(userId, orgId, calId, aufrufer, memberId, dto.role);
  }

  @Delete('booking-calendars/:calId/members/:memberId')
  @HttpCode(204)
  async entferneMitglied(
    @CurrentUserId() userId: string, @Param('orgId') orgId: string, @Param('calId', ParseUUIDPipe) calId: string,
    @Param('memberId', ParseUUIDPipe) memberId: string, @CurrentMembership() aufrufer: Membership
  ): Promise<void> {
    await this.plaene.entferneMitglied(userId, orgId, calId, aufrufer, memberId);
  }

  // ── Buchungen ───────────────────────────────────────────────────────────────

  @Get('booking-calendars/:calId/bookings')
  buchungsListe(@Param('orgId') orgId: string, @Param('calId', ParseUUIDPipe) calId: string, @CurrentMembership() aufrufer: Membership, @Query() q: RangeQueryDto) {
    return this.buchungen.liste(orgId, calId, aufrufer, q.from, q.to);
  }

  @Get('booking-calendars/:calId/availability')
  verfuegbarkeit(@Param('orgId') orgId: string, @Param('calId', ParseUUIDPipe) calId: string, @CurrentMembership() aufrufer: Membership, @Query() q: AvailabilityQueryDto) {
    return this.buchungen.verfuegbarkeit(orgId, calId, aufrufer, q.start_at, q.end_at);
  }

  @Post('booking-calendars/:calId/bookings')
  buchen(
    @CurrentUserId() userId: string, @Param('orgId') orgId: string, @Param('calId', ParseUUIDPipe) calId: string,
    @CurrentMembership() aufrufer: Membership, @Body() dto: CreateBookingDto
  ) {
    return this.buchungen.anlegen(userId, orgId, calId, aufrufer, dto);
  }

  @Patch('bookings/:id')
  buchungAendern(
    @CurrentUserId() userId: string, @Param('orgId') orgId: string, @Param('id', ParseUUIDPipe) id: string,
    @CurrentMembership() aufrufer: Membership, @Body() dto: UpdateBookingDto
  ) {
    return this.buchungen.aendern(userId, orgId, id, aufrufer, dto);
  }

  @Post('bookings/:id/approve')
  @HttpCode(200)
  annehmen(@CurrentUserId() userId: string, @Param('orgId') orgId: string, @Param('id', ParseUUIDPipe) id: string, @CurrentMembership() aufrufer: Membership) {
    return this.buchungen.annehmen(userId, orgId, id, aufrufer);
  }

  @Post('bookings/:id/decline')
  @HttpCode(200)
  ablehnen(
    @CurrentUserId() userId: string, @Param('orgId') orgId: string, @Param('id', ParseUUIDPipe) id: string,
    @CurrentMembership() aufrufer: Membership, @Body() dto: DeclineBookingDto
  ) {
    return this.buchungen.ablehnen(userId, orgId, id, aufrufer, dto.reason ?? null);
  }

  @Post('bookings/:id/cancel')
  @HttpCode(200)
  stornieren(@CurrentUserId() userId: string, @Param('orgId') orgId: string, @Param('id', ParseUUIDPipe) id: string, @CurrentMembership() aufrufer: Membership) {
    return this.buchungen.stornieren(userId, orgId, id, aufrufer);
  }

  @Delete('bookings/:id')
  @HttpCode(204)
  async buchungLoeschen(@CurrentUserId() userId: string, @Param('orgId') orgId: string, @Param('id', ParseUUIDPipe) id: string, @CurrentMembership() aufrufer: Membership): Promise<void> {
    await this.buchungen.loeschen(userId, orgId, id, aufrufer);
  }

  // ── Serien (nur Leitung) ────────────────────────────────────────────────────

  @Post('booking-calendars/:calId/series/preview')
  @HttpCode(200)
  serieVorschau(@Param('orgId') orgId: string, @Param('calId', ParseUUIDPipe) calId: string, @CurrentMembership() aufrufer: Membership, @Body() dto: SeriesDto) {
    return this.serien.vorschau(orgId, calId, aufrufer, dto);
  }

  @Post('booking-calendars/:calId/series')
  serieAnlegen(
    @CurrentUserId() userId: string, @Param('orgId') orgId: string, @Param('calId', ParseUUIDPipe) calId: string,
    @CurrentMembership() aufrufer: Membership, @Body() dto: SeriesDto
  ) {
    return this.serien.anlegen(userId, orgId, calId, aufrufer, dto);
  }

  @Patch('booking-series/:seriesId')
  serieUmbenennen(
    @CurrentUserId() userId: string, @Param('orgId') orgId: string, @Param('seriesId', ParseUUIDPipe) seriesId: string,
    @CurrentMembership() aufrufer: Membership, @Body() dto: RenameSeriesDto
  ) {
    return this.serien.umbenennen(userId, orgId, seriesId, aufrufer, dto.title);
  }

  @Post('booking-series/:seriesId/end')
  @HttpCode(200)
  serieBeenden(
    @CurrentUserId() userId: string, @Param('orgId') orgId: string, @Param('seriesId', ParseUUIDPipe) seriesId: string,
    @CurrentMembership() aufrufer: Membership, @Body() dto: EndSeriesDto
  ) {
    return this.serien.beenden(userId, orgId, seriesId, aufrufer, dto.from);
  }
}
