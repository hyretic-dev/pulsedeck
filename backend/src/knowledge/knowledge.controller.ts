import { Controller, HttpCode, Param, ParseUUIDPipe, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiParam, ApiTags } from '@nestjs/swagger';

import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import type { Membership } from '../tenancy/membership';
import { OrgGuard } from '../tenancy/org.guard';
import { PermissionGuard } from '../tenancy/require-permission';
import { CurrentMembership } from '../tenancy/request-context';

import { KnowledgeService } from './knowledge.service';

@ApiTags('knowledge')
@ApiBearerAuth()
@ApiParam({ name: 'orgId', format: 'uuid' })
@Controller('orgs/:orgId/files')
@UseGuards(JwtAuthGuard, OrgGuard, PermissionGuard)
export class KnowledgeController {
  constructor(private readonly wissen: KnowledgeService) {}

  /** Datei für die KI indizieren lassen (läuft im Hintergrund). Hochladende und Administratoren. */
  @Post(':fileId/index')
  @HttpCode(202)
  indexieren(@Param('orgId') orgId: string, @CurrentMembership() aufrufer: Membership, @Param('fileId', ParseUUIDPipe) fileId: string) {
    return this.wissen.indexAnfordern(orgId, aufrufer, fileId);
  }
}
