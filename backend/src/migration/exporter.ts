import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, readdir, stat } from 'node:fs/promises';
import { join, relative, resolve, sep } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { Transform } from 'node:stream';

import { Client } from 'pg';

import { MigrationError } from './errors';
import { MANIFEST_DATEI, schreibeJson, type Manifest, type StorageObject, type TableManifest } from './manifest';
import { pruefsummeSql, q, relation, spaltenAusdruck } from './sql';
import { NICHT_UEBERNOMMEN, TABLES, type TableSpec } from './tables';

export interface ExportOptions {
  sourceUrl: string;
  outDir: string;
  /** Lokale Kopie des Supabase-Storage (`<dir>/files/<storage_path>`), z. B. per rclone/`supabase storage cp`. */
  storageDir?: string;
  allowMissingObjects?: boolean;
  /** Tabellen der Quelle, die der Betreiber bewusst nicht übernimmt (sonst bricht der Export bei unbekannten Tabellen ab). */
  allowUnmapped?: string[];
  /** Nur diese Organisation (Slug) und ihre Daten übernehmen; alles andere bleibt draußen und wird im Manifest als ausgeschlossen gezählt. */
  onlyOrg?: string;
  /** Konten, die zusätzlich zu den Mitgliedern der Organisation mitkommen (z. B. ein Plattform-Administrator ohne Mitgliedschaft). */
  keepAccounts?: string[];
  log?: (zeile: string) => void;
}

const STAPEL = 500;

/**
 * Liest den Supabase-Bestand in einer einzigen REPEATABLE-READ-Transaktion (konsistenter Schnappschuss, nur lesend) und
 * schreibt je Tabelle eine NDJSON-Datei, die Dateiinhalte und ein Manifest mit Zeilenzahlen und kanonischen Prüfsummen.
 */
interface Umfang {
  slug: string;
  organizationId: string;
  keepAccounts: string[];
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Setzt {ORG} und {KONTEN} in einer Scope-Bedingung ein (nur geprüfte UUIDs, nie freier Text). */
function scopeSql(vorlage: string, u: Umfang): string {
  const org = `'${u.organizationId}'::uuid`;
  const konten = `(SELECT user_id FROM public.members WHERE organization_id = ${org} AND user_id IS NOT NULL
      UNION SELECT owner_id FROM public.organizations WHERE id = ${org} AND owner_id IS NOT NULL
      UNION SELECT user_id FROM public.chat_sessions WHERE organization_id = ${org}${u.keepAccounts.length ? `
      UNION SELECT id FROM auth.users WHERE id IN (${u.keepAccounts.map((k) => `'${k}'::uuid`).join(', ')})` : ''})`;
  return vorlage.replaceAll('{ORG}', org).replaceAll('{KONTEN}', konten);
}

export async function exportiere(opts: ExportOptions): Promise<Manifest> {
  const log = opts.log ?? (() => undefined);
  for (const k of opts.keepAccounts ?? []) if (!UUID.test(k)) throw new MigrationError('USAGE', `--keep-account erwartet eine UUID, erhalten: ${k.slice(0, 40)}`);
  await legeLeeresVerzeichnisAn(opts.outDir);

  const db = new Client({ connectionString: opts.sourceUrl });
  try {
    await db.connect();
  } catch (fehler) {
    throw new MigrationError('SOURCE_CONNECT', `Keine Verbindung zur Quelldatenbank: ${(fehler as Error).message}`);
  }
  try {
    await db.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    await db.query("SET TIME ZONE 'UTC'");
    const manifest: Manifest = {
      formatVersion: 1,
      createdAt: (await db.query<{ jetzt: Date }>('SELECT now() AS jetzt')).rows[0].jetzt.toISOString(),
      source: await vorabpruefung(db),
      tables: [],
      storage: { included: false, objects: [], missing: [] },
      skippedTables: NICHT_UEBERNOMMEN,
    };
    manifest.skippedTables = { ...manifest.skippedTables, ...(await pruefeUnbekannteTabellen(db, opts.allowUnmapped ?? [])) };
    let umfang: Umfang | undefined;
    if (opts.onlyOrg) {
      const { rows } = await db.query<{ id: string }>('SELECT id FROM public.organizations WHERE slug = $1', [opts.onlyOrg]);
      if (rows.length !== 1) throw new MigrationError('USAGE', `Organisation mit dem Slug „${opts.onlyOrg.slice(0, 60)}“ gibt es in der Quelle nicht`);
      umfang = { slug: opts.onlyOrg, organizationId: rows[0].id, keepAccounts: opts.keepAccounts ?? [] };
      manifest.scope = umfang;
      log(`Umfang: nur Organisation ${umfang.slug}${umfang.keepAccounts.length ? ` (+ ${umfang.keepAccounts.length} behaltene Konten)` : ''}`);
    } else if ((opts.keepAccounts ?? []).length > 0) {
      throw new MigrationError('USAGE', '--keep-account gilt nur zusammen mit --only-org');
    }
    log(`Quelle: PostgreSQL ${manifest.source.serverVersion}, Erweiterungen: ${manifest.source.extensions.join(', ')}`);

    for (const spec of TABLES) {
      const eintrag = await exportiereTabelle(db, spec, opts.outDir, umfang);
      manifest.tables.push(eintrag);
      log(
        eintrag.missingInSource
          ? `${spec.table}: Quelltabelle fehlt (optional)`
          : `${spec.table}: ${eintrag.exportedRows} Zeilen${eintrag.excluded ? `, ${eintrag.excluded.rows} ausgeschlossen (${eintrag.excluded.reason})` : ''}`
      );
    }

    if (opts.storageDir) manifest.storage = await exportiereDateien(db, opts.storageDir, opts.outDir, log, umfang);
    await db.query('ROLLBACK');

    await schreibeJson(join(opts.outDir, MANIFEST_DATEI), manifest);
    if (manifest.storage.missing.length > 0 && !opts.allowMissingObjects) {
      throw new MigrationError(
        'STORAGE_OBJECT_MISSING',
        `${manifest.storage.missing.length} Dateiinhalte fehlen in ${opts.storageDir} (Liste im Manifest). Mit --allow-missing-objects trotzdem fortfahren.`
      );
    }
    return manifest;
  } finally {
    await db.end().catch(() => undefined);
  }
}

async function legeLeeresVerzeichnisAn(dir: string): Promise<void> {
  await mkdir(dir, { recursive: true });
  if ((await readdir(dir)).length > 0) throw new MigrationError('USAGE', `Das Exportverzeichnis ${dir} ist nicht leer`);
}

async function vorabpruefung(db: Client): Promise<Manifest['source']> {
  const version = (await db.query<{ v: string }>("SELECT current_setting('server_version') AS v")).rows[0].v;
  const erweiterungen = (await db.query<{ extname: string }>('SELECT extname FROM pg_extension ORDER BY 1')).rows.map((r) => r.extname);
  const dbName = (await db.query<{ n: string }>('SELECT current_database() AS n')).rows[0].n;

  const anbieter: Record<string, number> = {};
  if (await vorhanden(db, 'auth.identities')) {
    for (const r of (await db.query<{ provider: string; n: number }>('SELECT provider, count(*)::int AS n FROM auth.identities GROUP BY 1 ORDER BY 1')).rows) anbieter[r.provider] = r.n;
  }
  const buckets: Manifest['source']['buckets'] = [];
  if ((await vorhanden(db, 'storage.buckets')) && (await vorhanden(db, 'storage.objects'))) {
    const { rows } = await db.query<{ id: string; public: boolean; n: number }>(
      'SELECT b.id, coalesce(b.public, false) AS public, count(o.id)::int AS n FROM storage.buckets b LEFT JOIN storage.objects o ON o.bucket_id = b.id GROUP BY b.id, b.public ORDER BY b.id'
    );
    for (const r of rows) buckets.push({ id: r.id, public: r.public, objects: r.n });
  }

  const groessen: Record<string, number> = {};
  for (const spec of TABLES) {
    const rel = spec.source ?? `public.${spec.table}`;
    if (!(await vorhanden(db, rel))) continue;
    const { rows } = await db.query<{ lesbar: boolean; bytes: string }>(
      'SELECT has_table_privilege(current_user, $1::regclass, $2) AS lesbar, pg_total_relation_size($1::regclass)::text AS bytes',
      [relation(rel), 'SELECT']
    );
    if (!rows[0].lesbar) throw new MigrationError('SOURCE_PRIVILEGE', `Keine Leserechte auf ${rel} (Exportkonto braucht SELECT auf public und auth.users)`);
    groessen[rel] = Number(rows[0].bytes);
  }
  return { database: dbName, serverVersion: version, extensions: erweiterungen, authProviders: anbieter, buckets, tableSizes: groessen };
}

/** Jede Tabelle in `public`, die die Registry nicht kennt, würde sonst stillschweigend fehlen (z. B. im Dashboard angelegte Tabellen). */
async function pruefeUnbekannteTabellen(db: Client, erlaubt: string[]): Promise<Record<string, string>> {
  const bekannt = new Set([...TABLES.map((t) => t.table), ...Object.keys(NICHT_UEBERNOMMEN)]);
  const { rows } = await db.query<{ t: string }>("SELECT table_name AS t FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE' ORDER BY 1");
  const unbekannt = rows.map((r) => r.t).filter((t) => !bekannt.has(t));
  const offen: string[] = [];
  const ausgelassen: Record<string, string> = {};
  for (const t of unbekannt) {
    if (erlaubt.includes(t)) ausgelassen[t] = 'vom Betreiber bewusst ausgelassen (--allow-unmapped)';
    else offen.push(`${t} (${(await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM ${relation(`public.${t}`)}`)).rows[0].n} Zeilen)`);
  }
  if (offen.length > 0) {
    throw new MigrationError('SCHEMA_DRIFT', `Tabellen in der Quelle ohne Zuordnung: ${offen.join(', ')}. In tables.ts aufnehmen (mit Zieltabelle) oder mit --allow-unmapped bewusst auslassen.`);
  }
  return ausgelassen;
}

async function vorhanden(db: Client, rel: string): Promise<boolean> {
  return (await db.query<{ r: string | null }>('SELECT to_regclass($1)::text AS r', [relation(rel)])).rows[0].r !== null;
}

async function exportiereTabelle(db: Client, spec: TableSpec, outDir: string, umfang?: Umfang): Promise<TableManifest> {
  const quelle = spec.source ?? `public.${spec.table}`;
  const datei = `${spec.table}.ndjson`;
  if (!(await vorhanden(db, quelle))) {
    if (!spec.optional) throw new MigrationError('SCHEMA_DRIFT', `Pflichttabelle ${quelle} fehlt in der Quelle`);
    await schreibeLeer(join(outDir, datei));
    return { table: spec.table, source: quelle, missingInSource: true, columns: [], compare: [], sourceRows: 0, exportedRows: 0, file: datei, fileSha256: createHash('sha256').digest('hex'), checksum: '' };
  }

  const [schema, name] = quelle.split('.');
  const vorhandene = (
    await db.query<{ column_name: string }>('SELECT column_name FROM information_schema.columns WHERE table_schema = $1 AND table_name = $2 ORDER BY ordinal_position', [schema, name])
  ).rows.map((r) => r.column_name);
  const spalten = spec.columns ?? vorhandene;
  const fehlend = spalten.filter((s) => !vorhandene.includes(s));
  if (fehlend.length > 0) throw new MigrationError('SCHEMA_DRIFT', `${quelle}: erwartete Spalten fehlen: ${fehlend.join(', ')}`);

  const compare = spec.compare ?? spalten.filter((s) => !(s in (spec.drop ?? {})) && !(spec.compareExclude ?? []).includes(s)).map(spaltenAusdruck);
  const bedingungen = [spec.where?.sql, umfang && spec.scope ? scopeSql(spec.scope, umfang) : undefined].filter(Boolean);
  const where = bedingungen.length > 0 ? bedingungen.map((b) => `(${b})`).join(' AND ') : undefined;
  const gesamt = (await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM ${relation(quelle)}`)).rows[0].n;

  const reihenfolge = spalten.includes('id') ? ` ORDER BY ${q('id')}` : '';
  const select = `SELECT ${spalten.map(q).join(', ')} FROM ${relation(quelle)}${where ? ` WHERE ${where}` : ''}${reihenfolge}`;
  const { exportiert, sha256 } = await schreibeStapelweise(db, `SELECT to_jsonb(t)::text AS zeile FROM (${select}) t`, join(outDir, datei));

  const summe = (await db.query<{ n: number; summe: string }>(pruefsummeSql(quelle, compare, where))).rows[0];
  if (summe.n !== exportiert) throw new MigrationError('EXPORT_CORRUPT', `${quelle}: ${exportiert} Zeilen geschrieben, Prüfsumme über ${summe.n}`);

  const eintrag: TableManifest = {
    table: spec.table,
    source: quelle,
    columns: spalten,
    compare,
    sourceRows: gesamt,
    exportedRows: exportiert,
    file: datei,
    fileSha256: sha256,
    checksum: summe.summe,
  };
  if (gesamt !== exportiert && (spec.where || (umfang && spec.scope))) {
    eintrag.excluded = { rows: gesamt - exportiert, reason: [spec.where?.reason, umfang && spec.scope ? 'andere Organisationen (--only-org)' : undefined].filter(Boolean).join('; ') };
  }
  if (spalten.includes('organization_id')) {
    const { rows } = await db.query<{ k: string | null; n: number }>(`SELECT organization_id::text AS k, count(*)::int AS n FROM ${relation(quelle)}${where ? ` WHERE ${where}` : ''} GROUP BY 1`);
    eintrag.perOrg = Object.fromEntries(rows.map((r) => [r.k ?? 'null', r.n]));
  }
  return eintrag;
}

async function schreibeLeer(pfad: string): Promise<void> {
  await pipeline(async function* () { /* leere Datei */ }, createWriteStream(pfad));
}

/** Schreibt die Zeilen über einen Cursor (konstanter Speicher) und gibt Zeilenzahl und SHA-256 der Datei zurück. */
async function schreibeStapelweise(db: Client, sql: string, pfad: string): Promise<{ exportiert: number; sha256: string }> {
  const hash = createHash('sha256');
  const aus = createWriteStream(pfad);
  let exportiert = 0;
  await db.query(`DECLARE export_cursor NO SCROLL CURSOR FOR ${sql}`);
  try {
    for (;;) {
      const { rows } = await db.query<{ zeile: string }>(`FETCH ${STAPEL} FROM export_cursor`);
      if (rows.length === 0) break;
      const text = rows.map((r) => `${r.zeile}\n`).join('');
      hash.update(text);
      exportiert += rows.length;
      if (!aus.write(text)) await new Promise<void>((ok) => aus.once('drain', () => ok()));
    }
  } finally {
    await db.query('CLOSE export_cursor');
    await new Promise<void>((ok, nein) => aus.end((e?: Error | null) => (e ? nein(e) : ok())));
  }
  return { exportiert, sha256: hash.digest('hex') };
}

async function exportiereDateien(db: Client, storageDir: string, outDir: string, log: (z: string) => void, umfang?: Umfang): Promise<Manifest['storage']> {
  const bucketDir = resolve(storageDir, 'files');
  await mkdir(join(outDir, 'storage'), { recursive: true });
  const { rows } = await db.query<{ id: string; organization_id: string; storage_path: string }>(
    `SELECT id, organization_id, storage_path FROM public.files WHERE organization_id IS NOT NULL${umfang ? ` AND organization_id = '${umfang.organizationId}'::uuid` : ''} ORDER BY id`
  );
  const objekte: StorageObject[] = [];
  const fehlend: Manifest['storage']['missing'] = [];
  for (const zeile of rows) {
    // In Produktion beginnt storage_path mit „/“ (`/<name>.pdf`), der Objektname im Bucket nicht. Führende Schrägstriche gehören
    // nicht zum Pfad; ein „..“ oder ein Ausbruch aus dem Bucket-Verzeichnis wird unten weiterhin abgewiesen.
    const quelle = resolve(bucketDir, zeile.storage_path.replace(/^\/+/, ''));
    // Pfadausbruch verhindern: der Quellpfad stammt aus der Datenbank, nicht von uns
    if (!quelle.startsWith(bucketDir + sep) || !(await stat(quelle).then((s) => s.isFile(), () => false))) {
      fehlend.push({ fileId: zeile.id, sourcePath: zeile.storage_path });
      continue;
    }
    const ziel = join(outDir, 'storage', zeile.id);
    const { sha256, size } = await kopiereMitPruefsumme(quelle, ziel);
    objekte.push({ fileId: zeile.id, organizationId: zeile.organization_id, sourcePath: zeile.storage_path, size, sha256, file: relative(outDir, ziel) });
  }
  log(`Dateien: ${objekte.length} kopiert, ${fehlend.length} fehlen`);
  return { included: true, objects: objekte, missing: fehlend };
}

export async function kopiereMitPruefsumme(quelle: string, ziel: string): Promise<{ sha256: string; size: number }> {
  const hash = createHash('sha256');
  let size = 0;
  const messen = new Transform({
    transform(teil: Buffer, _kodierung, weiter) {
      hash.update(teil);
      size += teil.length;
      weiter(null, teil);
    },
  });
  await pipeline(createReadStream(quelle), messen, createWriteStream(ziel));
  return { sha256: hash.digest('hex'), size };
}
