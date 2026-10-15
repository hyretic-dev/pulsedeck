import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiParam, ApiTags } from '@nestjs/swagger';

import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { verboten } from '../common/http-error';
import type { Membership } from '../tenancy/membership';
import { OrgGuard } from '../tenancy/org.guard';
import { isAdmin } from '../tenancy/permissions';
import { PermissionGuard, RequireAdmin } from '../tenancy/require-permission';
import { CurrentMembership, CurrentUserId } from '../tenancy/request-context';
import { OrgRoleDto } from '../tenancy/dto/tenancy.dto';

import {
  BulkDeleteDto,
  CreateMemberDto,
  CreateRoleDto,
  ImportMembersDto,
  InviteResultDto,
  ShareLinkResultDto,
  UpdateMemberDto,
  UpdateOwnProfileDto,
  UpdateRoleDto,
} from './dto/member.dto';
import { MembersService, type MitgliedsZeile } from './members.service';
import { RolesService } from './roles.service';

/**
 * Mitglieder und Rollen einer Organisation. Konto aus dem Token, Organisation aus dem Pfad, Rechte aus
 * der Datenbank; Schreibzugriffe nur durch Administratoren (Einladung und Weitergabe-Link auch Vorstand).
 */
@ApiTags('members')
@ApiBearerAuth()
@ApiParam({ name: 'orgId', format: 'uuid' })
@Controller('orgs/:orgId')
@UseGuards(JwtAuthGuard, OrgGuard, PermissionGuard)
export class MembersController {
  constructor(
    private readonly mitglieder: MembersService,
    private readonly rollen: RolesService
  ) {}

  @Get('members')
  liste(@Param('orgId') orgId: string, @CurrentMembership() aufrufer: Membership): Promise<MitgliedsZeile[]> {
    return this.mitglieder.liste(orgId, aufrufer);
  }

  @Post('members')
  @RequireAdmin()
  anlegen(@CurrentUserId() userId: string, @Param('orgId') orgId: string, @Body() dto: CreateMemberDto): Promise<MitgliedsZeile> {
    return this.mitglieder.anlegen(userId, orgId, { ...dto });
  }

  @Post('members/import')
  @HttpCode(200)
  @RequireAdmin()
  importieren(@CurrentUserId() userId: string, @Param('orgId') orgId: string, @Body() dto: ImportMembersDto): Promise<MitgliedsZeile[]> {
    return this.mitglieder.importieren(userId, orgId, dto.members.map((m) => ({ ...m })));
  }

  @Post('members/bulk-delete')
  @HttpCode(204)
  @RequireAdmin()
  async mehrereLoeschen(@CurrentUserId() userId: string, @Param('orgId') orgId: string, @Body() dto: BulkDeleteDto): Promise<void> {
    await this.mitglieder.loeschen(userId, orgId, dto.ids);
  }

  /** Eigenes Profil (Profilseite). Muss vor `members/:memberId` stehen. */
  @Patch('members/me')
  profilAendern(@CurrentUserId() userId: string, @CurrentMembership() aufrufer: Membership, @Body() dto: UpdateOwnProfileDto): Promise<MitgliedsZeile> {
    return this.mitglieder.profilAendern(userId, aufrufer, { ...dto });
  }

  @Patch('members/:memberId')
  @RequireAdmin()
  aendern(
    @CurrentUserId() userId: string,
    @Param('orgId') orgId: string,
    @Param('memberId', ParseUUIDPipe) memberId: string,
    @Body() dto: UpdateMemberDto
  ): Promise<MitgliedsZeile> {
    return this.mitglieder.aendern(userId, orgId, memberId, { ...dto });
  }

  @Delete('members/:memberId')
  @HttpCode(204)
  @RequireAdmin()
  async loeschen(@CurrentUserId() userId: string, @Param('orgId') orgId: string, @Param('memberId', ParseUUIDPipe) memberId: string): Promise<void> {
    await this.mitglieder.loeschen(userId, orgId, [memberId]);
  }

  @Post('members/:memberId/invite')
  @HttpCode(200)
  @RequireAdmin()
  @ApiOkResponse({ type: InviteResultDto })
  einladen(@CurrentUserId() userId: string, @Param('orgId') orgId: string, @Param('memberId', ParseUUIDPipe) memberId: string): Promise<InviteResultDto> {
    return this.mitglieder.einladen(userId, orgId, memberId);
  }

  /** Administratoren und Vorstand dürfen einen Anmelde-Link zum Weitergeben erzeugen (nur für Mitglieder ohne bestätigtes Konto). */
  @Post('members/:memberId/magic-link')
  @HttpCode(200)
  @ApiOkResponse({ type: ShareLinkResultDto })
  weitergabeLink(
    @CurrentUserId() userId: string,
    @CurrentMembership() aufrufer: Membership,
    @Param('orgId') orgId: string,
    @Param('memberId', ParseUUIDPipe) memberId: string
  ): Promise<ShareLinkResultDto> {
    if (!isAdmin(aufrufer) && aufrufer.member.app_role !== 'committee') throw verboten();
    return this.mitglieder.weitergabeLink(userId, orgId, memberId);
  }

  @Post('roles')
  @RequireAdmin()
  @ApiOkResponse({ type: OrgRoleDto })
  rolleAnlegen(@Param('orgId') orgId: string, @Body() dto: CreateRoleDto): Promise<OrgRoleDto> {
    return this.rollen.anlegen(orgId, { ...dto });
  }

  @Patch('roles/:roleId')
  @RequireAdmin()
  @ApiOkResponse({ type: OrgRoleDto })
  rolleAendern(@Param('orgId') orgId: string, @Param('roleId', ParseUUIDPipe) roleId: string, @Body() dto: UpdateRoleDto): Promise<OrgRoleDto> {
    return this.rollen.aendern(orgId, roleId, { ...dto });
  }

  @Delete('roles/:roleId')
  @HttpCode(204)
  @RequireAdmin()
  async rolleLoeschen(@Param('orgId') orgId: string, @Param('roleId', ParseUUIDPipe) roleId: string): Promise<void> {
    await this.rollen.loeschen(orgId, roleId);
  }
}
