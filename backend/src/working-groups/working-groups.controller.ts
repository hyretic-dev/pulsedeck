import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Put, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiParam, ApiTags } from '@nestjs/swagger';

import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import type { Membership } from '../tenancy/membership';
import { OrgGuard } from '../tenancy/org.guard';
import { PermissionGuard, RequireAdmin } from '../tenancy/require-permission';
import { CurrentMembership, CurrentUserId } from '../tenancy/request-context';

import { AgMemberRoleDto, CreateWorkingGroupDto, UpdateWorkingGroupDto } from './dto/working-group.dto';
import { WorkingGroupsService } from './working-groups.service';

@ApiTags('working-groups')
@ApiBearerAuth()
@ApiParam({ name: 'orgId', format: 'uuid' })
@Controller('orgs/:orgId/working-groups')
@UseGuards(JwtAuthGuard, OrgGuard, PermissionGuard)
export class WorkingGroupsController {
  constructor(private readonly gruppen: WorkingGroupsService) {}

  @Get()
  liste(@Param('orgId') orgId: string, @CurrentMembership() aufrufer: Membership) {
    return this.gruppen.liste(orgId, aufrufer);
  }

  @Get('categories')
  kategorien(@Param('orgId') orgId: string) {
    return this.gruppen.kategorien(orgId);
  }

  @Get('mine')
  meine(@Param('orgId') orgId: string, @CurrentMembership() aufrufer: Membership) {
    return this.gruppen.meine(orgId, aufrufer);
  }

  @Post()
  @RequireAdmin()
  anlegen(@CurrentUserId() userId: string, @Param('orgId') orgId: string, @Body() dto: CreateWorkingGroupDto) {
    return this.gruppen.anlegen(userId, orgId, { ...dto });
  }

  @Patch(':groupId')
  aendern(
    @CurrentUserId() userId: string,
    @CurrentMembership() aufrufer: Membership,
    @Param('orgId') orgId: string,
    @Param('groupId', ParseUUIDPipe) groupId: string,
    @Body() dto: UpdateWorkingGroupDto
  ) {
    return this.gruppen.aendern(userId, orgId, aufrufer, groupId, { ...dto });
  }

  @Delete(':groupId')
  @HttpCode(204)
  @RequireAdmin()
  async loeschen(@CurrentUserId() userId: string, @Param('orgId') orgId: string, @Param('groupId', ParseUUIDPipe) groupId: string): Promise<void> {
    await this.gruppen.loeschen(userId, orgId, groupId);
  }

  @Get(':groupId/members')
  mitglieder(@Param('orgId') orgId: string, @Param('groupId', ParseUUIDPipe) groupId: string) {
    return this.gruppen.mitglieder(orgId, groupId);
  }

  /** Eigener Beitritt (immer als Mitglied). Vor `members/:memberId` registrieren. */
  @Put(':groupId/members/me')
  beitreten(@Param('orgId') orgId: string, @CurrentMembership() aufrufer: Membership, @Param('groupId', ParseUUIDPipe) groupId: string) {
    return this.gruppen.beitreten(orgId, aufrufer, groupId);
  }

  @Put(':groupId/members/:memberId')
  hinzufuegen(
    @CurrentUserId() userId: string,
    @CurrentMembership() aufrufer: Membership,
    @Param('orgId') orgId: string,
    @Param('groupId', ParseUUIDPipe) groupId: string,
    @Param('memberId', ParseUUIDPipe) memberId: string,
    @Body() dto: AgMemberRoleDto
  ) {
    return this.gruppen.hinzufuegen(userId, orgId, aufrufer, groupId, memberId, dto.role);
  }

  @Patch(':groupId/members/:memberId')
  @HttpCode(204)
  async rolleAendern(
    @CurrentUserId() userId: string,
    @CurrentMembership() aufrufer: Membership,
    @Param('orgId') orgId: string,
    @Param('groupId', ParseUUIDPipe) groupId: string,
    @Param('memberId', ParseUUIDPipe) memberId: string,
    @Body() dto: AgMemberRoleDto
  ): Promise<void> {
    await this.gruppen.rolleAendern(userId, orgId, aufrufer, groupId, memberId, dto.role);
  }

  @Delete(':groupId/members/:memberId')
  @HttpCode(204)
  async entfernen(
    @CurrentUserId() userId: string,
    @CurrentMembership() aufrufer: Membership,
    @Param('orgId') orgId: string,
    @Param('groupId', ParseUUIDPipe) groupId: string,
    @Param('memberId', ParseUUIDPipe) memberId: string
  ): Promise<void> {
    await this.gruppen.entfernen(userId, orgId, aufrufer, groupId, memberId);
  }
}
