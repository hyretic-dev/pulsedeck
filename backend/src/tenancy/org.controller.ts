import { Controller, Get, Inject, Param, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiParam, ApiTags } from '@nestjs/swagger';

import { JwtAuthGuard } from '../auth/jwt-auth.guard';

import { MemberDto, OrgRoleDto } from './dto/tenancy.dto';
import type { Membership, MembershipRepository } from './membership';
import { OrgGuard } from './org.guard';
import { effectivePermissions, isAdmin } from './permissions';
import { CurrentMembership } from './request-context';
import { MEMBERSHIP_REPOSITORY } from './tenancy.tokens';

/**
 * Organisationsbezogene Endpunkte. JwtAuthGuard + OrgGuard: Konto aus dem Token, Organisation aus
 * dem Pfad, Mitgliedschaft aus der Datenbank. Nichts davon kommt aus Query, Header oder Body.
 */
@ApiTags('organizations')
@ApiBearerAuth()
@ApiParam({ name: 'orgId', format: 'uuid' })
@Controller('orgs/:orgId')
@UseGuards(JwtAuthGuard, OrgGuard)
export class OrgController {
  constructor(@Inject(MEMBERSHIP_REPOSITORY) private readonly memberships: MembershipRepository) {}

  /** Das eigene Mitglied in dieser Organisation (Ersatz für den `currentMember`-Abruf des Frontends). */
  @Get('members/me')
  @ApiOkResponse({ type: MemberDto })
  me(@CurrentMembership() membership: Membership): MemberDto {
    return {
      ...membership.member,
      org_role: membership.orgRole,
      access: {
        isOwner: membership.isOwner,
        isAdmin: isAdmin(membership),
        permissions: effectivePermissions(membership),
      },
    };
  }

  /** Rollen der Organisation; sichtbar für alle ihre Mitglieder (wie im Bestand). */
  @Get('roles')
  @ApiOkResponse({ type: [OrgRoleDto] })
  roles(@Param('orgId') orgId: string): Promise<OrgRoleDto[]> {
    return this.memberships.listRoles(orgId);
  }
}
