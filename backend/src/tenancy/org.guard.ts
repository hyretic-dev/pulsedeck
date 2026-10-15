import { CanActivate, ExecutionContext, HttpException, Inject, Injectable } from '@nestjs/common';

import type { Membership, MembershipRepository } from './membership';
import { MEMBERSHIP_REPOSITORY } from './tenancy.tokens';

export type OrgRequest = {
  userId?: string;
  params?: { orgId?: string };
  membership?: Membership;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Lässt nur Mitglieder der Organisation aus dem Pfad (`:orgId`) durch und legt die geprüfte
 * Mitgliedschaft am Request ab. Muss nach JwtAuthGuard laufen: die Identität kommt allein aus dem
 * verifizierten Token, die Organisation allein aus dem Pfad. Query, Header und Body zählen nie.
 *
 * Fremde und nicht existierende Organisationen liefern dieselbe Antwort (403), damit niemand
 * Organisations-IDs abtasten kann.
 */
@Injectable()
export class OrgGuard implements CanActivate {
  constructor(@Inject(MEMBERSHIP_REPOSITORY) private readonly memberships: MembershipRepository) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<OrgRequest>();
    const orgId = request.params?.orgId;
    if (!orgId || !UUID.test(orgId)) {
      throw new HttpException(
        { code: 'validation_failed', message: 'Ungültige Organisations-ID' },
        400
      );
    }
    if (!request.userId) {
      throw new HttpException({ code: 'unauthorized', message: 'Nicht authentifiziert' }, 401);
    }

    const membership = await this.memberships.find(request.userId, orgId);
    if (!membership) {
      throw new HttpException(
        { code: 'not_a_member', message: 'Kein Zugriff auf diese Organisation' },
        403
      );
    }
    request.membership = membership;
    return true;
  }
}
