import { Body, Controller, Get, HttpCode, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiCreatedResponse, ApiOkResponse, ApiParam, ApiTags } from '@nestjs/swagger';

import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { nichtGefunden } from '../common/http-error';
import { OrgGuard } from '../tenancy/org.guard';
import { RequireAdmin, PermissionGuard } from '../tenancy/require-permission';
import { CurrentUserId } from '../tenancy/request-context';

import { CreateOrganizationDto, OrganizationDto, SlugAvailabilityDto, UpdateOrganizationDto } from './dto/organization.dto';
import { Organisation, OrganizationsService } from './organizations.service';

/** Organisationen: Anlegen (jedes Konto), Lesen (Mitglieder), Ändern (Administratoren). */
@ApiTags('organizations')
@ApiBearerAuth()
@Controller()
export class OrganizationsController {
  constructor(private readonly organisationen: OrganizationsService) {}

  /** Konto-ID kommt aus dem Token; die Organisation entsteht mit dem Aufrufer als Besitzer und Admin. */
  @Post('orgs')
  @UseGuards(JwtAuthGuard)
  @ApiCreatedResponse({ type: OrganizationDto })
  anlegen(@CurrentUserId() userId: string, @Body() dto: CreateOrganizationDto): Promise<Organisation> {
    return this.organisationen.anlegen(userId, { name: dto.name, slug: dto.slug, ownerName: dto.owner_name });
  }

  @Get('me/organizations')
  @UseGuards(JwtAuthGuard)
  @ApiOkResponse({ type: [OrganizationDto] })
  meine(@CurrentUserId() userId: string): Promise<Organisation[]> {
    return this.organisationen.meineOrganisationen(userId);
  }

  @Get('orgs/:orgId')
  @UseGuards(JwtAuthGuard, OrgGuard)
  @ApiParam({ name: 'orgId', format: 'uuid' })
  @ApiOkResponse({ type: OrganizationDto })
  lesen(@Param('orgId') orgId: string): Promise<Organisation> {
    return this.organisationen.findePerId(orgId);
  }

  @Patch('orgs/:orgId')
  @UseGuards(JwtAuthGuard, OrgGuard, PermissionGuard)
  @RequireAdmin()
  @ApiParam({ name: 'orgId', format: 'uuid' })
  @ApiOkResponse({ type: OrganizationDto })
  aendern(
    @CurrentUserId() userId: string,
    @Param('orgId') orgId: string,
    @Body() dto: UpdateOrganizationDto
  ): Promise<Organisation> {
    return this.organisationen.aendern(userId, orgId, dto);
  }
}

/** Öffentlich lesbare Organisationsdaten (anonym, ohne Anmeldung). */
@ApiTags('public')
@Controller('public')
export class PublicOrganizationsController {
  constructor(private readonly organisationen: OrganizationsService) {}

  @Get('slugs/:slug')
  @HttpCode(200)
  @ApiOkResponse({ type: SlugAvailabilityDto })
  async slug(@Param('slug') slug: string): Promise<SlugAvailabilityDto> {
    return { available: await this.organisationen.istSlugFrei(slug) };
  }

  @Get('organizations/:slug')
  @ApiOkResponse({ type: OrganizationDto })
  async organisation(@Param('slug') slug: string): Promise<Organisation> {
    const org = await this.organisationen.findePerSlug(slug);
    if (!org) throw nichtGefunden('Organisation');
    return org;
  }

  @Get('organizations/:slug/overview')
  @ApiOkResponse({ description: 'Mitgliederzahl, nächste öffentliche Termine, Wiki, Beiträge, Arbeitsgruppen, Kontakte' })
  async uebersicht(@Param('slug') slug: string): Promise<Record<string, unknown>> {
    const org = await this.organisationen.findePerSlug(slug);
    if (!org) throw nichtGefunden('Organisation');
    return this.organisationen.oeffentlicheUebersicht(org.id);
  }
}
