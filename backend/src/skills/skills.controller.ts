import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Put, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiParam, ApiTags } from '@nestjs/swagger';

import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { verboten } from '../common/http-error';
import type { Membership } from '../tenancy/membership';
import { OrgGuard } from '../tenancy/org.guard';
import { isAdmin } from '../tenancy/permissions';
import { PermissionGuard, RequireAdmin } from '../tenancy/require-permission';
import { CurrentMembership, CurrentUserId } from '../tenancy/request-context';

import { CreateSkillDto, MatchMembersDto, SetMemberSkillsDto, UpdateSkillDto } from './dto/skill.dto';
import { SkillsService } from './skills.service';

/** Fähigkeiten, Interessen und Verfügbarkeiten einer Organisation und ihre Zuordnung zu Mitgliedern. */
@ApiTags('skills')
@ApiBearerAuth()
@ApiParam({ name: 'orgId', format: 'uuid' })
@Controller('orgs/:orgId')
@UseGuards(JwtAuthGuard, OrgGuard, PermissionGuard)
export class SkillsController {
  constructor(private readonly skills: SkillsService) {}

  @Get('skills')
  liste(@Param('orgId') orgId: string) {
    return this.skills.liste(orgId);
  }

  @Post('skills')
  @RequireAdmin()
  anlegen(@CurrentUserId() userId: string, @Param('orgId') orgId: string, @Body() dto: CreateSkillDto) {
    return this.skills.anlegen(userId, orgId, dto);
  }

  /** Muss vor `skills/:skillId` stehen. */
  @Post('skills/match')
  @HttpCode(200)
  mitglieder(@CurrentMembership() aufrufer: Membership, @Param('orgId') orgId: string, @Body() dto: MatchMembersDto) {
    // Das Ergebnis enthält E-Mail-Adressen: nur Vorstand und Administratoren.
    if (!isAdmin(aufrufer) && aufrufer.member.app_role !== 'committee') throw verboten();
    return this.skills.mitgliederMitSkills(orgId, dto.skill_ids);
  }

  @Patch('skills/:skillId')
  @RequireAdmin()
  aendern(@CurrentUserId() userId: string, @Param('orgId') orgId: string, @Param('skillId', ParseUUIDPipe) skillId: string, @Body() dto: UpdateSkillDto) {
    return this.skills.aendern(userId, orgId, skillId, { ...dto });
  }

  @Delete('skills/:skillId')
  @HttpCode(204)
  @RequireAdmin()
  async loeschen(@CurrentUserId() userId: string, @Param('orgId') orgId: string, @Param('skillId', ParseUUIDPipe) skillId: string): Promise<void> {
    await this.skills.loeschen(userId, orgId, skillId);
  }

  @Get('member-skills')
  alle(@Param('orgId') orgId: string) {
    return this.skills.alleZuordnungen(orgId);
  }

  @Get('members/:memberId/skills')
  vonMitglied(@Param('orgId') orgId: string, @Param('memberId', ParseUUIDPipe) memberId: string) {
    return this.skills.skillIdsVon(orgId, memberId);
  }

  @Put('members/:memberId/skills')
  setzen(@CurrentMembership() aufrufer: Membership, @Param('orgId') orgId: string, @Param('memberId', ParseUUIDPipe) memberId: string, @Body() dto: SetMemberSkillsDto) {
    return this.skills.setzeSkills(orgId, aufrufer, memberId, dto.skill_ids);
  }

  @Put('members/:memberId/skills/:skillId')
  @HttpCode(204)
  async hinzufuegen(@CurrentMembership() aufrufer: Membership, @Param('orgId') orgId: string, @Param('memberId', ParseUUIDPipe) memberId: string, @Param('skillId', ParseUUIDPipe) skillId: string): Promise<void> {
    await this.skills.fuegeHinzu(orgId, aufrufer, memberId, skillId);
  }

  @Delete('members/:memberId/skills/:skillId')
  @HttpCode(204)
  async entfernen(@CurrentMembership() aufrufer: Membership, @Param('orgId') orgId: string, @Param('memberId', ParseUUIDPipe) memberId: string, @Param('skillId', ParseUUIDPipe) skillId: string): Promise<void> {
    await this.skills.entferne(orgId, aufrufer, memberId, skillId);
  }
}
