/** Bezeichner für SQL quoten (Namen stammen aus der Registry oder dem Informationsschema, nie von außen). */
export const q = (name: string): string => `"${name.replace(/"/g, '""')}"`;

/** `schema.tabelle` bzw. `tabelle` quoten. */
export const relation = (name: string): string => name.split('.').map(q).join('.');

/**
 * Kanonische Prüfsumme einer Relation: Zeilenzahl und MD5 über die sortierten MD5-Werte der JSON-Zeilen. Gleiche Werte
 * ergeben unabhängig von Reihenfolge und Speicherort dieselbe Summe (Zeitzone des Zugriffs ist UTC, Spaltenreihenfolge
 * folgt der Liste).
 */
export function pruefsummeSql(rel: string, ausdruecke: string[], where?: string): string {
  return `SELECT count(*)::int AS n, coalesce(md5(string_agg(h, '' ORDER BY h)), md5('')) AS summe
          FROM (SELECT md5(row_to_json(t)::text) AS h FROM (SELECT ${ausdruecke.join(', ')} FROM ${relation(rel)}${where ? ` WHERE ${where}` : ''}) t) z`;
}

/** Spaltenausdruck → Quoting für reine Spaltennamen, Ausdrücke (mit Klammer oder AS) bleiben unverändert. */
export const spaltenAusdruck = (spalte: string): string => (/^[a-z_][a-z0-9_]*$/i.test(spalte) ? q(spalte) : spalte);
