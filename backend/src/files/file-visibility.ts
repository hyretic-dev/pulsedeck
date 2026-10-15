/**
 * SQL-Bedingung, ob Datei `alias` für ein Mitglied sichtbar ist (Ausdrücke für Mitglieds-ID, Rang 1–3, Arbeitsgruppen uuid[]):
 * der Hochladende und Administratoren immer; sonst nach `visibility`: public/member = alle Mitglieder der Organisation,
 * committee = Vorstand und Admin, admin = nur Admin, ag-only = Mitglieder der Arbeitsgruppe der Datei.
 * Der Bestand ließ jedes angemeldete Konto Dateien jeder Organisation lesen (Policy `auth.uid() IS NOT NULL`).
 */
export function dateiSichtbarkeitsAusdruck(mitglied: string, rang: string, arbeitsgruppen: string, alias = 'f'): string {
  return `(
    ${alias}.uploaded_by = ${mitglied} OR (${rang}) >= 3 OR
    CASE ${alias}.visibility
      WHEN 'public' THEN true
      WHEN 'member' THEN true
      WHEN 'committee' THEN (${rang}) >= 2
      WHEN 'admin' THEN (${rang}) >= 3
      WHEN 'ag-only' THEN ${alias}.working_group_id = ANY(${arbeitsgruppen})
      ELSE false
    END)`;
}

/** Wie `dateiSichtbarkeitsAusdruck` für den Aufrufer: Positionsparameter ab `ab` ($ab = Mitglieds-ID, $ab+1 = Rang, $ab+2 = Arbeitsgruppen). */
export function dateiSichtbarkeitsBedingung(ab: number, alias = 'f'): string {
  return dateiSichtbarkeitsAusdruck(`$${ab}::uuid`, `$${ab + 1}::int`, `$${ab + 2}::uuid[]`, alias);
}
