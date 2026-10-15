import { Controller, Get, Inject, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiTags } from '@nestjs/swagger';

import { JwtAuthGuard } from '../auth/jwt-auth.guard';

import { MembershipSummaryDto } from './dto/tenancy.dto';
import type { MembershipRepository } from './membership';
import { CurrentUserId } from './request-context';
import { MEMBERSHIP_REPOSITORY } from './tenancy.tokens';

/** Konto-bezogene Sicht auf die eigenen Mitgliedschaften (Ersatz für den RPC `get_user_memberships`). */
@ApiTags('me')
@ApiBearerAuth()
@Controller('me')
@UseGuards(JwtAuthGuard)
export class MeController {
  constructor(@Inject(MEMBERSHIP_REPOSITORY) private readonly memberships: MembershipRepository) {}

  /** Die Konto-ID kommt ausschließlich aus dem verifizierten Token. */
  @Get('memberships')
  @ApiOkResponse({ type: [MembershipSummaryDto] })
  list(@CurrentUserId() userId: string): Promise<MembershipSummaryDto[]> {
    return this.memberships.listForUser(userId);
  }
}
