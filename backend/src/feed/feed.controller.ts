import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Put, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiParam, ApiTags } from '@nestjs/swagger';

import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import type { Membership } from '../tenancy/membership';
import { OrgGuard } from '../tenancy/org.guard';
import { PermissionGuard, RequirePermission } from '../tenancy/require-permission';
import { CurrentMembership, CurrentUserId } from '../tenancy/request-context';

import { CreateFeedItemDto, PinDto, UpdateFeedItemDto } from './dto/feed.dto';
import { FeedService } from './feed.service';

@ApiTags('feed')
@ApiBearerAuth()
@ApiParam({ name: 'orgId', format: 'uuid' })
@Controller('orgs/:orgId/feed')
@UseGuards(JwtAuthGuard, OrgGuard, PermissionGuard)
export class FeedController {
  constructor(private readonly feed: FeedService) {}

  @Get()
  veroeffentlicht(@Param('orgId') orgId: string, @CurrentMembership() aufrufer: Membership) {
    return this.feed.veroeffentlicht(orgId, aufrufer);
  }

  @Get('mine')
  eigene(@Param('orgId') orgId: string, @CurrentMembership() aufrufer: Membership) {
    return this.feed.eigene(orgId, aufrufer);
  }

  @Get('review')
  zurPruefung(@Param('orgId') orgId: string, @CurrentMembership() aufrufer: Membership) {
    return this.feed.zurPruefung(orgId, aufrufer);
  }

  @Get('newsletter-queue')
  warteschlange(@Param('orgId') orgId: string, @CurrentMembership() aufrufer: Membership) {
    return this.feed.newsletterWarteschlange(orgId, aufrufer);
  }

  @Get('sent')
  versendet(@Param('orgId') orgId: string, @CurrentMembership() aufrufer: Membership) {
    return this.feed.versendet(orgId, aufrufer);
  }

  @Post()
  @RequirePermission('feed:create')
  anlegen(@CurrentUserId() userId: string, @CurrentMembership() aufrufer: Membership, @Param('orgId') orgId: string, @Body() dto: CreateFeedItemDto) {
    return this.feed.anlegen(userId, orgId, aufrufer, { ...dto });
  }

  @Put('options/:optionId/vote')
  @HttpCode(204)
  async abstimmen(@Param('orgId') orgId: string, @CurrentMembership() aufrufer: Membership, @Param('optionId', ParseUUIDPipe) optionId: string): Promise<void> {
    await this.feed.abstimmen(orgId, aufrufer, optionId);
  }

  @Delete('options/:optionId/vote')
  @HttpCode(204)
  async stimmeZurueckziehen(@Param('orgId') orgId: string, @CurrentMembership() aufrufer: Membership, @Param('optionId', ParseUUIDPipe) optionId: string): Promise<void> {
    await this.feed.stimmeZurueckziehen(orgId, aufrufer, optionId);
  }

  @Patch(':itemId')
  aendern(
    @CurrentUserId() userId: string,
    @CurrentMembership() aufrufer: Membership,
    @Param('orgId') orgId: string,
    @Param('itemId', ParseUUIDPipe) itemId: string,
    @Body() dto: UpdateFeedItemDto
  ) {
    return this.feed.aendern(userId, orgId, aufrufer, itemId, { ...dto });
  }

  @Delete(':itemId')
  @HttpCode(204)
  async loeschen(
    @CurrentUserId() userId: string,
    @CurrentMembership() aufrufer: Membership,
    @Param('orgId') orgId: string,
    @Param('itemId', ParseUUIDPipe) itemId: string
  ): Promise<void> {
    await this.feed.loeschen(userId, orgId, aufrufer, itemId);
  }

  @Patch(':itemId/pin')
  anheften(
    @CurrentUserId() userId: string,
    @CurrentMembership() aufrufer: Membership,
    @Param('orgId') orgId: string,
    @Param('itemId', ParseUUIDPipe) itemId: string,
    @Body() dto: PinDto
  ) {
    return this.feed.anheften(userId, orgId, aufrufer, itemId, dto.is_pinned);
  }

  @Put(':itemId/read')
  @HttpCode(204)
  async gelesen(@Param('orgId') orgId: string, @CurrentMembership() aufrufer: Membership, @Param('itemId', ParseUUIDPipe) itemId: string): Promise<void> {
    await this.feed.alsGelesen(orgId, aufrufer, itemId);
  }
}
