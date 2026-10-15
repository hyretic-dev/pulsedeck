import type { Pool } from 'pg';

import type {
  AppRole,
  MemberProfile,
  Membership,
  MembershipRepository,
  MembershipSummary,
  OrgRole,
} from '../../tenancy/membership';

type MemberRow = MemberProfile & {
  org_role_name: string;
  org_role_description: string | null;
  org_role_is_system_admin: boolean;
  org_role_is_default: boolean;
  org_role_permissions: string[];
  org_role_created_at: Date;
  org_role_updated_at: Date;
  is_owner: boolean;
};

export const ROLLEN_SPALTEN =
  `id, organization_id, name, description, COALESCE(permissions, '{}') AS permissions,
   COALESCE(is_system_admin, false) AS is_system_admin, COALESCE(is_default, false) AS is_default,
   created_at, updated_at`;

/** Mitgliedschaften und Rollen; alle Abfragen sind parametrisiert und an das Konto bzw. die Organisation gebunden. */
export class PgMembershipRepository implements MembershipRepository {
  constructor(private readonly pool: Pool) {}

  async listForUser(userId: string): Promise<MembershipSummary[]> {
    const { rows } = await this.pool.query<MembershipSummary & { app_role: AppRole }>(
      `SELECT m.id AS member_id, m.name AS member_name, o.id AS organization_id,
              o.name AS organization_name, o.slug AS organization_slug, m.app_role
         FROM members m
         JOIN organizations o ON o.id = m.organization_id
        WHERE m.user_id = $1
        ORDER BY o.name, m.id`,
      [userId]
    );
    return rows;
  }

  async find(userId: string, organizationId: string): Promise<Membership | null> {
    const { rows } = await this.pool.query<MemberRow>(
      `SELECT m.id, m.organization_id, m.user_id, m.name, m.role, m.department, m.status,
              m.email::text AS email, m.join_date, m.avatar_url, m.app_role,
              COALESCE(m.permissions, '{}') AS permissions, m.role_id, m.street, m.zip_code,
              m.city, m.phone, m.birthday, m.custom_info,
              COALESCE(m.contact_channels, '{}') AS contact_channels, m.calendar_token,
              m.created_at, m.updated_at,
              r.name AS org_role_name, r.description AS org_role_description,
              COALESCE(r.is_system_admin, false) AS org_role_is_system_admin,
              COALESCE(r.is_default, false) AS org_role_is_default,
              COALESCE(r.permissions, '{}') AS org_role_permissions,
              r.created_at AS org_role_created_at, r.updated_at AS org_role_updated_at,
              (o.owner_id = m.user_id) AS is_owner
         FROM members m
         JOIN organizations o ON o.id = m.organization_id
         JOIN organization_roles r ON r.id = m.role_id AND r.organization_id = m.organization_id
        WHERE m.user_id = $1 AND m.organization_id = $2`,
      [userId, organizationId]
    );
    const row = rows[0];
    if (!row) return null;
    const orgRole: OrgRole = {
      id: row.role_id,
      organization_id: row.organization_id,
      name: row.org_role_name,
      description: row.org_role_description,
      permissions: row.org_role_permissions,
      is_system_admin: row.org_role_is_system_admin,
      is_default: row.org_role_is_default,
      created_at: row.org_role_created_at,
      updated_at: row.org_role_updated_at,
    };
    const {
      org_role_name: _a, org_role_description: _b, org_role_is_system_admin: _c, org_role_is_default: _d,
      org_role_permissions: _e, org_role_created_at: _f, org_role_updated_at: _g, is_owner, ...member
    } = row;
    return { isOwner: is_owner, orgRole, member };
  }

  async listRoles(organizationId: string): Promise<OrgRole[]> {
    const { rows } = await this.pool.query<OrgRole>(
      `SELECT ${ROLLEN_SPALTEN} FROM organization_roles
        WHERE organization_id = $1
        ORDER BY is_system_admin DESC NULLS LAST, name`,
      [organizationId]
    );
    return rows;
  }
}
