export type AppRole = 'public' | 'member' | 'committee' | 'admin';
export type MemberStatus = 'Active' | 'Inactive' | 'Pending';

/**
 * Die Domänentypen tragen die Spaltennamen des Bestands (snake_case): Das Frontend-Modell `Member`
 * und die API-Verträge bleiben dadurch ohne Abbildung stabil (E22).
 */

/** Rolle aus organization_roles (benutzerdefiniert je Organisation). */
export interface OrgRole {
  id: string;
  organization_id: string;
  name: string;
  description: string | null;
  permissions: string[];
  is_system_admin: boolean;
  is_default: boolean;
  created_at: Date;
  updated_at: Date;
}

/** Kurzform für die Organisationsauswahl (Ersatz für den RPC `get_user_memberships`). */
export interface MembershipSummary {
  member_id: string;
  member_name: string;
  organization_id: string;
  organization_name: string;
  organization_slug: string;
  app_role: AppRole;
}

/** Das Mitglied selbst (ohne Verknüpfungs-Token, das nie nach außen geht). */
export interface MemberProfile {
  id: string;
  organization_id: string;
  user_id: string;
  name: string;
  role: string | null;
  department: string | null;
  status: MemberStatus;
  email: string;
  join_date: string;
  avatar_url: string | null;
  app_role: AppRole;
  permissions: string[];
  role_id: string;
  street: string | null;
  zip_code: string | null;
  city: string | null;
  phone: string | null;
  birthday: string | null;
  custom_info: string | null;
  contact_channels: Record<string, unknown>;
  calendar_token: string | null;
  created_at: Date;
  updated_at: Date;
}

/**
 * Verifizierte Mitgliedschaft eines Kontos in genau einer Organisation. Wird nur aus der
 * Datenbank geladen (nie aus Request-Feldern) und ist Grundlage jeder Rechteprüfung.
 */
export interface Membership {
  member: MemberProfile;
  orgRole: OrgRole;
  /** organizations.owner_id gehört diesem Konto. */
  isOwner: boolean;
}

export interface MembershipRepository {
  listForUser(userId: string): Promise<MembershipSummary[]>;
  find(userId: string, organizationId: string): Promise<Membership | null>;
  listRoles(organizationId: string): Promise<OrgRole[]>;
}

/** Verknüpft noch nicht verbundene Mitglieder (user_id IS NULL) mit einem Konto. */
export interface MemberLinker {
  /** Nur für Konten mit bestätigter E-Mail aufrufen. Liefert die Anzahl verknüpfter Mitglieder. */
  linkByVerifiedEmail(userId: string, email: string): Promise<number>;
  /** Mitglieder (auch bereits verknüpfte) mit dieser E-Mail, optional in einer Organisation. */
  findInvitationTargets(email: string, organizationId?: string): Promise<InvitationTarget[]>;
}

export interface InvitationTarget {
  memberId: string;
  userId: string | null;
  organizationId: string;
  organizationName: string;
}
