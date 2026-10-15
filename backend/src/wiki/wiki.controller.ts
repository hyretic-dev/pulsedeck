import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiParam, ApiTags } from '@nestjs/swagger';

import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import type { Membership } from '../tenancy/membership';
import { OrgGuard } from '../tenancy/org.guard';
import { PermissionGuard } from '../tenancy/require-permission';
import { CurrentMembership, CurrentUserId } from '../tenancy/request-context';

import { CreateWikiCategoryDto, CreateWikiDocDto, UpdateWikiCategoryDto, UpdateWikiDocDto } from './dto/wiki.dto';
import { WikiService } from './wiki.service';

@ApiTags('wiki')
@ApiBearerAuth()
@ApiParam({ name: 'orgId', format: 'uuid' })
@Controller('orgs/:orgId/wiki')
@UseGuards(JwtAuthGuard, OrgGuard, PermissionGuard)
export class WikiController {
  constructor(private readonly wiki: WikiService) {}

  @Get('docs')
  dokumente(@Param('orgId') orgId: string, @CurrentMembership() aufrufer: Membership) {
    return this.wiki.dokumente(orgId, aufrufer);
  }

  @Get('docs/:docId')
  dokument(@Param('orgId') orgId: string, @CurrentMembership() aufrufer: Membership, @Param('docId', ParseUUIDPipe) docId: string) {
    return this.wiki.dokument(orgId, aufrufer, docId);
  }

  @Post('docs')
  anlegen(@CurrentUserId() userId: string, @CurrentMembership() aufrufer: Membership, @Param('orgId') orgId: string, @Body() dto: CreateWikiDocDto) {
    return this.wiki.anlegen(userId, orgId, aufrufer, { ...dto });
  }

  @Patch('docs/:docId')
  aendern(
    @CurrentUserId() userId: string,
    @CurrentMembership() aufrufer: Membership,
    @Param('orgId') orgId: string,
    @Param('docId', ParseUUIDPipe) docId: string,
    @Body() dto: UpdateWikiDocDto
  ) {
    return this.wiki.aendern(userId, orgId, aufrufer, docId, { ...dto });
  }

  @Delete('docs/:docId')
  @HttpCode(204)
  async loeschen(@CurrentUserId() userId: string, @CurrentMembership() aufrufer: Membership, @Param('orgId') orgId: string, @Param('docId', ParseUUIDPipe) docId: string): Promise<void> {
    await this.wiki.loeschen(userId, orgId, aufrufer, docId);
  }

  @Get('categories')
  kategorien(@Param('orgId') orgId: string, @CurrentMembership() aufrufer: Membership) {
    return this.wiki.kategorien(orgId, aufrufer);
  }

  @Post('categories')
  kategorieAnlegen(@CurrentUserId() userId: string, @CurrentMembership() aufrufer: Membership, @Param('orgId') orgId: string, @Body() dto: CreateWikiCategoryDto) {
    return this.wiki.kategorieAnlegen(userId, orgId, aufrufer, { ...dto });
  }

  @Patch('categories/:categoryId')
  kategorieAendern(
    @CurrentUserId() userId: string,
    @CurrentMembership() aufrufer: Membership,
    @Param('orgId') orgId: string,
    @Param('categoryId', ParseUUIDPipe) categoryId: string,
    @Body() dto: UpdateWikiCategoryDto
  ) {
    return this.wiki.kategorieAendern(userId, orgId, aufrufer, categoryId, { ...dto });
  }

  @Delete('categories/:categoryId')
  @HttpCode(204)
  async kategorieLoeschen(
    @CurrentUserId() userId: string,
    @CurrentMembership() aufrufer: Membership,
    @Param('orgId') orgId: string,
    @Param('categoryId', ParseUUIDPipe) categoryId: string
  ): Promise<void> {
    await this.wiki.kategorieLoeschen(userId, orgId, aufrufer, categoryId);
  }
}
