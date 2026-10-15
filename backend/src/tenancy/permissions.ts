import type { Membership } from './membership';

/** Berechtigungsschlüssel, die das Frontend heute kennt (members.permissions, organization_roles.permissions). */
export const PERMISSION_KEYS = [
  'feed:create',
  'feed:approve',
  'wiki:edit',
  'events:create',
  'contacts:edit',
  'view_issue_tracker',
] as const;

export type PermissionKey = (typeof PERMISSION_KEYS)[number];

/**
 * Administrator einer Organisation: Besitzer, System-Admin-Rolle oder Legacy-`app_role = 'admin'`.
 * Entspricht `is_admin_of_org() OR is_owner_of_org()` im Bestand.
 */
export function isAdmin(membership: Membership): boolean {
  return (
    membership.isOwner ||
    membership.orgRole.is_system_admin ||
    membership.member.app_role === 'admin'
  );
}

/**
 * Hat die Mitgliedschaft die Berechtigung `key`? Reihenfolge (Vorschlag E21, Bestätigung offen):
 * Administratoren haben alles; `committee` hat wie in `has_permission(key)` und im Frontend alle
 * Schlüssel; sonst zählt die Rolle der Organisation oder das mitgliedsbezogene Legacy-Array.
 */
export function hasPermission(membership: Membership, key: string): boolean {
  if (isAdmin(membership)) return true;
  if (membership.member.app_role === 'committee') return true;
  return membership.orgRole.permissions.includes(key) || membership.member.permissions.includes(key);
}

/** Wirksame Schlüssel (serverseitig aufgelöst, nur Anzeige für das Frontend, keine Berechtigung). */
export function effectivePermissions(membership: Membership): PermissionKey[] {
  return PERMISSION_KEYS.filter((key) => hasPermission(membership, key));
}
