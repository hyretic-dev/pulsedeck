import type { Pool } from 'pg';

import type { InvitationTarget, MemberLinker } from '../../tenancy/membership';

/**
 * Verknüpft Mitglieder ohne Konto (user_id IS NULL) per E-Mail mit einem Konto. Ersatz für den
 * Bestands-Trigger `handle_new_user_linking` auf auth.users. Nur für bestätigte E-Mails aufrufen:
 * E-Mail allein ohne geprüfte Identität darf keine Mitgliedschaft übertragen (Gesamtauftrag §5).
 *
 * Bereits verknüpfte Mitglieder bleiben unangetastet, ebenso Organisationen, in denen das Konto
 * schon Mitglied ist (eine Mitgliedschaft je Konto und Organisation).
 */
export class PgMemberLinker implements MemberLinker {
  constructor(private readonly pool: Pool) {}

  async linkByVerifiedEmail(userId: string, email: string): Promise<number> {
    const { rowCount } = await this.pool.query(
      `UPDATE members m
          SET user_id = $1, updated_at = now()
        WHERE m.email = $2
          AND m.user_id IS NULL
          AND m.organization_id IS NOT NULL
          AND NOT EXISTS (
            SELECT 1 FROM members x WHERE x.user_id = $1 AND x.organization_id = m.organization_id
          )`,
      [userId, email]
    );
    return rowCount ?? 0;
  }

  async findInvitationTargets(email: string, organizationId?: string): Promise<InvitationTarget[]> {
    const { rows } = await this.pool.query<{
      member_id: string;
      user_id: string | null;
      organization_id: string;
      organization_name: string;
    }>(
      `SELECT m.id AS member_id, m.user_id, o.id AS organization_id, o.name AS organization_name
         FROM members m JOIN organizations o ON o.id = m.organization_id
        WHERE m.email = $1 AND ($2::uuid IS NULL OR m.organization_id = $2)
        ORDER BY o.name, m.id`,
      [email, organizationId ?? null]
    );
    return rows.map((r) => ({
      memberId: r.member_id,
      userId: r.user_id,
      organizationId: r.organization_id,
      organizationName: r.organization_name,
    }));
  }
}
