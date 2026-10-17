import type { Membership } from '../tenancy/membership';
import { isAdmin } from '../tenancy/permissions';

/** Rang der Mitgliedschaft für die Terminsichtbarkeit: Mitglied 1, Vorstand 2, Administrator 3. */
export function sichtbarkeitsRang(m: Membership): number {
  if (isAdmin(m)) return 3;
  if (m.member.app_role === 'committee') return 2;
  return 1;
}

/**
 * SQL-Bedingung, ob ein Termin `e` für ein Mitglied sichtbar ist, gegeben als SQL-Ausdrücke für den Rang (1-3)
 * und die Arbeitsgruppen (uuid[]). Die Stufen entsprechen den Optionen des Kalenders: Öffentlich/Nur Mitglieder
 * (Rang 1), Nur Vorstand (2), Nur Admin (3); leere Rollenliste mit Arbeitsgruppe = nur deren Mitglieder (und
 * Administratoren). Der Bestand setzte das nicht durch: jedes Mitglied sah jeden Termin der Organisation.
 */
export function sichtbarkeitsAusdruck(rang: string, arbeitsgruppen: string): string {
  return `(
    CASE WHEN COALESCE(cardinality(e.allowed_roles), 0) = 0
         THEN (e.working_group_id IS NULL OR e.working_group_id = ANY(${arbeitsgruppen}) OR (${rang}) >= 3)
         ELSE (${rang}) >= (SELECT min(CASE r WHEN 'public' THEN 0 WHEN 'member' THEN 1 WHEN 'committee' THEN 2 WHEN 'admin' THEN 3 ELSE 9 END) FROM unnest(e.allowed_roles) r)
    END)`;
}

/** Wie `sichtbarkeitsAusdruck` für den Aufrufer: Positionsparameter ab `ab` ($ab = Rang, $ab+1 = UUID[] seiner Arbeitsgruppen). */
export function sichtbarkeitsBedingung(ab: number): string {
  return sichtbarkeitsAusdruck(`$${ab}::int`, `$${ab + 1}::uuid[]`);
}
