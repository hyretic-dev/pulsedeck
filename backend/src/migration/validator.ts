import { readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';

import { Client } from 'pg';

import { MigrationError } from './errors';
import { liesManifest, schreibeJson, sha256Datei } from './manifest';
import { pruefsummeSql, q, relation } from './sql';

export interface ValidateOptions {
  exportDir: string;
  targetUrl: string;
  filesDir: string;
  log?: (zeile: string) => void;
}

export interface Pruefung {
  name: string;
  ok: boolean;
  detail?: string;
}

export interface ValidierungsBericht {
  ok: boolean;
  checkedAt: string;
  pruefungen: Pruefung[];
}

/**
 * Vergleicht das Ziel mit dem Manifest des Exports – nicht nur Zeilenzahlen: kanonische Inhaltsprüfsummen je Tabelle
 * (inkl. Zeitstempel und Vektoren), Zählungen je Organisation, Fremdschlüsselkonsistenz, Dateiinhalte (Größe, SHA-256)
 * und die Schlüsselablage.
 */
export async function validiere(opts: ValidateOptions): Promise<ValidierungsBericht> {
  const { manifest } = await liesManifest(opts.exportDir);
  const db = new Client({ connectionString: opts.targetUrl });
  await db.connect().catch((e: Error) => {
    throw new MigrationError('TARGET_CONNECT', `Keine Verbindung zur Zieldatenbank: ${e.message}`);
  });
  const pruefungen: Pruefung[] = [];
  const pruefe = (name: string, ok: boolean, detail?: string): void => {
    pruefungen.push({ name, ok, ...(detail ? { detail } : {}) });
    opts.log?.(`${ok ? 'ok    ' : 'FEHLER'} ${name}${detail ? `: ${detail}` : ''}`);
  };

  try {
    await db.query("SET TIME ZONE 'UTC'");

    for (const tm of manifest.tables) {
      if (tm.missingInSource) continue;
      const summe = (await db.query<{ n: number; summe: string }>(pruefsummeSql(`public.${tm.table}`, tm.compare))).rows[0];
      pruefe(`${tm.table}: Zeilenzahl`, summe.n === tm.exportedRows, `${summe.n} im Ziel, ${tm.exportedRows} im Export${tm.excluded ? ` (${tm.excluded.rows} bewusst ausgeschlossen: ${tm.excluded.reason})` : ''}`);
      pruefe(`${tm.table}: Inhaltsprüfsumme`, summe.summe === tm.checksum);
      if (tm.perOrg) {
        const { rows } = await db.query<{ k: string | null; n: number }>(`SELECT organization_id::text AS k, count(*)::int AS n FROM ${relation(`public.${tm.table}`)} GROUP BY 1`);
        const ziel = Object.fromEntries(rows.map((r) => [r.k ?? 'null', r.n]));
        const abweichend = Object.keys({ ...tm.perOrg, ...ziel }).filter((k) => tm.perOrg?.[k] !== ziel[k]);
        pruefe(`${tm.table}: Zeilen je Organisation`, abweichend.length === 0, abweichend.length ? `${abweichend.length} Organisationen weichen ab` : undefined);
      }
    }

    await pruefeFremdschluessel(db, pruefe);
    await pruefeDateien(db, opts, manifest, pruefe);
    await pruefeSonstiges(db, pruefe);
  } finally {
    await db.end().catch(() => undefined);
  }

  const bericht: ValidierungsBericht = { ok: pruefungen.every((p) => p.ok), checkedAt: new Date().toISOString(), pruefungen };
  await schreibeJson(join(opts.exportDir, 'validation-report.json'), bericht);
  return bericht;
}

type Pruefer = (name: string, ok: boolean, detail?: string) => void;

async function pruefeFremdschluessel(db: Client, pruefe: Pruefer): Promise<void> {
  const nichtValide = (await db.query<{ conname: string }>("SELECT conname FROM pg_constraint WHERE NOT convalidated AND connamespace = 'public'::regnamespace")).rows;
  pruefe('Constraints: alle validiert', nichtValide.length === 0, nichtValide.map((r) => r.conname).join(', ') || undefined);
  const indizes = (await db.query<{ i: string }>('SELECT indexrelid::regclass::text AS i FROM pg_index WHERE NOT indisvalid')).rows;
  pruefe('Indizes: alle gültig', indizes.length === 0, indizes.map((r) => r.i).join(', ') || undefined);

  const { rows: fks } = await db.query<{ conname: string; kind: string; eltern: string; kspalten: string[]; espalten: string[] }>(
    `SELECT c.conname, c.conrelid::regclass::text AS kind, c.confrelid::regclass::text AS eltern,
       (SELECT array_agg(a.attname::text ORDER BY k.ord) FROM unnest(c.conkey) WITH ORDINALITY k(attnum, ord) JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = k.attnum) AS kspalten,
       (SELECT array_agg(a.attname::text ORDER BY k.ord) FROM unnest(c.confkey) WITH ORDINALITY k(attnum, ord) JOIN pg_attribute a ON a.attrelid = c.confrelid AND a.attnum = k.attnum) AS espalten
     FROM pg_constraint c WHERE c.contype = 'f' AND c.connamespace = 'public'::regnamespace ORDER BY 1`
  );
  const verwaist: string[] = [];
  for (const fk of fks) {
    const gesetzt = fk.kspalten.map((s) => `c.${q(s)} IS NOT NULL`).join(' AND ');
    const gleich = fk.kspalten.map((s, i) => `p.${q(fk.espalten[i])} = c.${q(s)}`).join(' AND ');
    const { rows } = await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM ${fk.kind} c WHERE ${gesetzt} AND NOT EXISTS (SELECT 1 FROM ${fk.eltern} p WHERE ${gleich})`);
    if (rows[0].n > 0) verwaist.push(`${fk.conname} (${rows[0].n})`);
  }
  pruefe(`Fremdschlüssel: keine verwaisten Verweise (${fks.length} geprüft)`, verwaist.length === 0, verwaist.join(', ') || undefined);
}

async function pruefeDateien(db: Client, opts: ValidateOptions, manifest: Awaited<ReturnType<typeof liesManifest>>['manifest'], pruefe: Pruefer): Promise<void> {
  const { rows: dateien } = await db.query<{ id: string; organization_id: string; storage_path: string; size_bytes: string | null }>('SELECT id, organization_id, storage_path, size_bytes::text FROM files');
  const falschePfade = dateien.filter((d) => d.storage_path !== `${d.organization_id}/${d.id}`);
  pruefe('Dateien: storage_path = <organization_id>/<id>', falschePfade.length === 0, falschePfade.length ? `${falschePfade.length} Zeilen` : undefined);

  const objekte = new Map(manifest.storage.objects.map((o) => [o.fileId, o]));
  const erlaubtFehlend = new Set(manifest.storage.missing.map((m) => m.fileId));
  const probleme: string[] = [];
  let groessenAbweichung = 0;
  for (const datei of dateien) {
    const objekt = objekte.get(datei.id);
    if (!objekt) {
      if (!erlaubtFehlend.has(datei.id)) probleme.push(`${datei.id}: nicht im Export-Manifest`);
      continue;
    }
    const ziel = join(opts.filesDir, objekt.organizationId, objekt.fileId);
    const gelesen = await sha256Datei(ziel).catch(() => null);
    if (!gelesen) probleme.push(`${datei.id}: Inhalt fehlt im Speicher`);
    else if (gelesen.sha256 !== objekt.sha256 || gelesen.size !== objekt.size) probleme.push(`${datei.id}: Inhalt weicht ab`);
    if (datei.size_bytes !== null && Number(datei.size_bytes) !== objekt.size) groessenAbweichung += 1;
  }
  pruefe(`Dateien: Inhalte im Speicher stimmen (${manifest.storage.objects.length} Objekte, SHA-256 und Größe)`, probleme.length === 0, probleme.slice(0, 5).join('; ') || undefined);
  if (erlaubtFehlend.size > 0) pruefe(`Dateien: ${erlaubtFehlend.size} Inhalte fehlten schon in der Quelle (--allow-missing-objects)`, true);
  if (groessenAbweichung > 0) pruefe('Dateien: size_bytes weicht vom tatsächlichen Inhalt ab', true, `${groessenAbweichung} Zeilen (Hinweis, Metadaten bleiben unverändert)`);

  const bekannt = new Set(dateien.map((d) => `${d.organization_id}/${d.id}`));
  const ueberzaehlig: string[] = [];
  for (const org of await readdir(opts.filesDir).catch(() => [] as string[])) {
    if (!(await stat(join(opts.filesDir, org)).then((s) => s.isDirectory(), () => false))) continue;
    for (const name of await readdir(join(opts.filesDir, org))) if (!bekannt.has(`${org}/${name}`)) ueberzaehlig.push(`${org}/${name}`);
  }
  pruefe('Datei-Volume: keine Objekte ohne Metadaten', ueberzaehlig.length === 0, ueberzaehlig.length ? `${ueberzaehlig.length} verwaiste Objekte` : undefined);
}

async function pruefeSonstiges(db: Client, pruefe: Pruefer): Promise<void> {
  const dims = (await db.query<{ d: number | null }>('SELECT DISTINCT vector_dims(embedding) AS d FROM knowledge_base WHERE embedding IS NOT NULL')).rows.map((r) => r.d);
  pruefe('Vektoren: einheitliche Dimension', dims.length <= 1, dims.length ? `${dims[0]} Dimensionen` : 'keine Vektoren');
  const sequenzen = (await db.query<{ sequencename: string }>("SELECT sequencename FROM pg_sequences WHERE schemaname = 'public' AND sequencename <> 'pgmigrations_id_seq'")).rows; // pgmigrations führt node-pg-migrate
  pruefe('Sequenzen: keine fachlichen (UUID-Schlüssel)', sequenzen.length === 0, sequenzen.map((s) => s.sequencename).join(', ') || undefined);
  const admins = (await db.query<{ n: number }>('SELECT count(*)::int AS n FROM auth_users WHERE is_platform_admin')).rows[0].n;
  pruefe('Plattform-Administratoren', true, `${admins} Konten`);
}
