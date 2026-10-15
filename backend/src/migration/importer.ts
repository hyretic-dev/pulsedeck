import { createHash, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { copyFile, mkdir, readFile, rename, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { createInterface } from 'node:readline';

import { Client } from 'pg';

import type { PasswordHasher } from '../auth/auth.service';
import type { SecretBox } from '../common/secret-box';
import { MigrationError } from './errors';
import { liesManifest, schreibeJson, sha256Datei, type Manifest, type TableManifest } from './manifest';
import { q, relation } from './sql';
import { TABLES, type TableSpec } from './tables';
import { UMWANDLUNGEN, type Kontext, type Zeile } from './umwandlungen';

export interface ImportOptions {
  exportDir: string;
  /** Zugang der Migrations-Rolle (Owner): schreibt auch `auth_users`. */
  targetUrl: string;
  /** Wurzel des Datei-Volumes (FILES_DIR des Backends). */
  filesDir: string;
  secretBox: SecretBox;
  hasher: PasswordHasher;
  /** Probelauf: alles in einer Transaktion, die zurückgerollt wird; kein Dateikopieren, kein Checkpoint. */
  dryRun?: boolean;
  /** Konten, die Plattform-Administratoren werden (der früher fest einkodierte „Super Admin“). */
  platformAdminIds?: string[];
  /** Organisation, der die frühere globale Newsletter-Konfiguration zugeordnet wird. */
  newsletterOrgId?: string;
  showDetails?: boolean;
  log?: (zeile: string) => void;
}

export interface ImportBericht {
  status: 'complete' | 'failed' | 'dry-run-ok';
  startedAt: string;
  finishedAt?: string;
  manifestSha256: string;
  tables: Record<string, { exported: number; inserted: number; skippedByCheckpoint?: boolean }>;
  transformations: Record<string, number>;
  mappedValues: Record<string, string[]>;
  storage: { copied: number; alreadyPresent: number; missingInExport: string[] };
  failure?: { code: string; message: string };
}

interface Checkpoint {
  manifestSha256: string;
  tables: string[];
  storageDone: boolean;
}

const STAPEL = 500;
const BERICHT = 'import-report.json';

export async function importiere(opts: ImportOptions): Promise<ImportBericht> {
  const log = opts.log ?? (() => undefined);
  const dry = opts.dryRun === true;
  const { manifest, sha256 } = await liesManifest(opts.exportDir);
  const bericht: ImportBericht = {
    status: 'failed',
    startedAt: new Date().toISOString(),
    manifestSha256: sha256,
    tables: {},
    transformations: {},
    mappedValues: {},
    storage: { copied: 0, alreadyPresent: 0, missingInExport: manifest.storage.missing.map((m) => m.fileId) },
  };

  let checkpoint: Checkpoint = leerCheckpoint(sha256);
  let kontext: Kontext | undefined;
  try {
    await pruefeExport(manifest, opts.exportDir);
    const dateienExportiert = manifest.tables.find((t) => t.table === 'files')?.exportedRows ?? 0;
    if (!manifest.storage.included && dateienExportiert > 0) {
      throw new MigrationError('STORAGE_OBJECT_MISSING', 'Der Export enthält keine Dateiinhalte (--storage-dir beim Export angeben)');
    }
    const admins = new Set(opts.platformAdminIds ?? []);
    await pruefePlattformAdmins(manifest, opts.exportDir, admins);

    const checkpointPfad = join(opts.exportDir, checkpointName(opts.targetUrl));
    checkpoint = dry ? leerCheckpoint(sha256) : await ladeCheckpoint(checkpointPfad, sha256);
    const db = new Client({ connectionString: opts.targetUrl });
    await db.connect().catch((e: Error) => {
      throw new MigrationError('TARGET_CONNECT', `Keine Verbindung zur Zieldatenbank: ${e.message}`);
    });
    try {
      await db.query("SET TIME ZONE 'UTC'");
      const ziel = await zielSpalten(db);
      kontext = baueKontext(db, opts, manifest, admins);
      await pruefeCheckpointGegenZiel(db, checkpoint, manifest);

      if (dry) await db.query('BEGIN');
      try {
        for (const spec of TABLES) {
          const tm = manifest.tables.find((t) => t.table === spec.table);
          if (!tm) throw new MigrationError('EXPORT_CORRUPT', `Manifest ohne Tabelle ${spec.table}`);
          bericht.tables[spec.table] = { exported: tm.exportedRows, inserted: 0 };
          if (checkpoint.tables.includes(spec.table)) {
            bericht.tables[spec.table].skippedByCheckpoint = true;
            log(`${spec.table}: laut Checkpoint bereits importiert`);
            continue;
          }
          if (!dry) await db.query('BEGIN');
          try {
            await pruefeLeer(db, spec.table);
            bericht.tables[spec.table].inserted = tm.missingInSource ? 0 : await importiereTabelle(db, spec, tm, opts, ziel.get(spec.table), kontext);
            if (!dry) await db.query('COMMIT');
          } catch (fehler) {
            if (!dry) await db.query('ROLLBACK');
            throw fehler;
          }
          if (!dry) {
            checkpoint.tables.push(spec.table);
            await schreibeJson(checkpointPfad, checkpoint);
          }
          log(`${spec.table}: ${bericht.tables[spec.table].inserted} von ${tm.exportedRows} Zeilen`);
        }
      } finally {
        if (dry) await db.query('ROLLBACK');
      }
    } finally {
      await db.end().catch(() => undefined);
    }

    if (!checkpoint.storageDone) {
      Object.assign(bericht.storage, await kopiereDateien(manifest, opts, dry));
      if (!dry) {
        checkpoint.storageDone = true;
        await schreibeJson(join(opts.exportDir, checkpointName(opts.targetUrl)), checkpoint);
      }
    }
    bericht.status = dry ? 'dry-run-ok' : 'complete';
  } catch (fehler) {
    const f = fehler instanceof MigrationError ? fehler : new MigrationError('UNEXPECTED', (fehler as Error).message);
    bericht.failure = { code: f.code, message: f.message };
    bericht.finishedAt = new Date().toISOString();
    if (kontext) uebernehme(bericht, kontext);
    if (!dry) await schreibeJson(join(opts.exportDir, BERICHT), bericht);
    throw f;
  }
  bericht.finishedAt = new Date().toISOString();
  if (kontext) uebernehme(bericht, kontext);
  if (!dry) await schreibeJson(join(opts.exportDir, BERICHT), bericht);
  return bericht;
}

// --- Prüfungen vor dem ersten Schreibzugriff ---------------------------------------------------------------------

async function pruefeExport(manifest: Manifest, dir: string): Promise<void> {
  for (const spec of TABLES) {
    if (!manifest.tables.some((t) => t.table === spec.table)) throw new MigrationError('EXPORT_CORRUPT', `Manifest ohne Tabelle ${spec.table}`);
  }
  for (const tm of manifest.tables) {
    const { sha256 } = await sha256Datei(join(dir, tm.file)).catch(() => {
      throw new MigrationError('EXPORT_CORRUPT', `Exportdatei ${tm.file} fehlt`);
    });
    if (sha256 !== tm.fileSha256) throw new MigrationError('EXPORT_CORRUPT', `Prüfsumme von ${tm.file} stimmt nicht mit dem Manifest überein`);
  }
}

async function pruefePlattformAdmins(manifest: Manifest, dir: string, admins: Set<string>): Promise<void> {
  if (admins.size === 0) return;
  const tm = manifest.tables.find((t) => t.table === 'auth_users');
  const gefunden = new Set<string>();
  if (tm) for await (const zeile of zeilen(join(dir, tm.file))) if (admins.has(String(zeile.id))) gefunden.add(String(zeile.id));
  const fehlend = [...admins].filter((id) => !gefunden.has(id));
  if (fehlend.length > 0) throw new MigrationError('UNKNOWN_PLATFORM_ADMIN', `Plattform-Administrator nicht im Export: ${fehlend.join(', ')}`);
}

async function pruefeLeer(db: Client, tabelle: string): Promise<void> {
  const { rows } = await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM ${relation(tabelle)}`);
  if (rows[0].n > 0) {
    throw new MigrationError('TARGET_NOT_EMPTY', `Zieltabelle ${tabelle} enthält bereits ${rows[0].n} Zeilen (Ziel muss leer sein; nach einem Abbruch Import mit demselben Exportverzeichnis fortsetzen)`);
  }
}

// --- Tabellenimport ----------------------------------------------------------------------------------------------

async function zielSpalten(db: Client): Promise<Map<string, Set<string>>> {
  const { rows } = await db.query<{ table_name: string; column_name: string }>("SELECT table_name, column_name FROM information_schema.columns WHERE table_schema = 'public'");
  const karte = new Map<string, Set<string>>();
  for (const r of rows) karte.set(r.table_name, (karte.get(r.table_name) ?? new Set()).add(r.column_name));
  for (const spec of TABLES) if (!karte.has(spec.table)) throw new MigrationError('SCHEMA_DRIFT', `Zieltabelle ${spec.table} fehlt (Migrationen ausgeführt?)`);
  return karte;
}

async function importiereTabelle(db: Client, spec: TableSpec, tm: TableManifest, opts: ImportOptions, spalten: Set<string> | undefined, kontext: Kontext): Promise<number> {
  if (tm.exportedRows === 0) return 0;
  await kontext.vorbereiten(spec.table);
  const umwandeln = UMWANDLUNGEN[spec.table];
  let eingefuegt = 0;
  let zielSpaltenListe: string[] | undefined;

  try {
    for await (const stapel of stapelAus(join(opts.exportDir, tm.file))) {
      const zeilen = umwandeln ? stapel.map((z) => umwandeln(z, kontext)) : stapel;
      if (!zielSpaltenListe) {
        zielSpaltenListe = Object.keys(zeilen[0]);
        const unbekannt = zielSpaltenListe.filter((s) => !spalten?.has(s));
        if (unbekannt.length > 0) throw new MigrationError('SCHEMA_DRIFT', `${spec.table}: Quellspalten ohne Gegenstück im Ziel: ${unbekannt.join(', ')} (in tables.ts als drop mit Begründung führen oder Schema anpassen)`);
      }
      const spaltenSql = zielSpaltenListe.map(q).join(', ');
      // Bei Selbstbezug zuerst ohne Verweis einfügen, danach setzen: unabhängig von der Zeilenreihenfolge
      const einzufuegen = spec.selfRef ? zeilen.map((z) => ({ ...z, [spec.selfRef as string]: null })) : zeilen;
      const res = await db.query(`INSERT INTO ${relation(spec.table)} (${spaltenSql}) SELECT ${spaltenSql} FROM jsonb_populate_recordset(NULL::${relation(spec.table)}, $1::jsonb)`, [JSON.stringify(einzufuegen)]);
      eingefuegt += res.rowCount ?? 0;
      if (spec.selfRef) {
        const mitBezug = zeilen.filter((z) => z[spec.selfRef as string] !== null && z[spec.selfRef as string] !== undefined).map((z) => ({ id: z.id, ref: z[spec.selfRef as string] }));
        if (mitBezug.length > 0) {
          await db.query(`UPDATE ${relation(spec.table)} t SET ${q(spec.selfRef)} = x.ref FROM jsonb_to_recordset($1::jsonb) AS x(id uuid, ref uuid) WHERE t.id = x.id`, [JSON.stringify(mitBezug)]);
        }
      }
    }
  } catch (fehler) {
    throw uebersetze(fehler, spec.table, opts.showDetails === true);
  }
  if (eingefuegt !== tm.exportedRows) throw new MigrationError('EXPORT_CORRUPT', `${spec.table}: ${eingefuegt} Zeilen eingefügt, ${tm.exportedRows} erwartet`);
  return eingefuegt;
}

function uebersetze(fehler: unknown, tabelle: string, details: boolean): Error {
  if (fehler instanceof MigrationError) return fehler;
  const e = fehler as { code?: string; message: string; constraint?: string; detail?: string };
  if (e.code && /^(22|23)/.test(e.code)) {
    // Die Meldung nennt Constraint, aber keine Werte; `detail` enthält Schlüsselwerte (Personendaten) und nur auf Wunsch
    const kurz = e.message.split(':')[0];
    return new MigrationError('CONSTRAINT_VIOLATION', `${tabelle}: ${kurz}${e.constraint ? ` (Constraint ${e.constraint})` : ''}${details && e.detail ? ` – ${e.detail}` : ''}`);
  }
  return fehler as Error;
}

async function* zeilen(pfad: string): AsyncGenerator<Zeile> {
  const leser = createInterface({ input: createReadStream(pfad), crlfDelay: Infinity });
  for await (const zeile of leser) if (zeile.trim() !== '') yield JSON.parse(zeile) as Zeile;
}

async function* stapelAus(pfad: string): AsyncGenerator<Zeile[]> {
  let stapel: Zeile[] = [];
  for await (const zeile of zeilen(pfad)) {
    stapel.push(zeile);
    if (stapel.length === STAPEL) {
      yield stapel;
      stapel = [];
    }
  }
  if (stapel.length > 0) yield stapel;
}

function baueKontext(db: Client, opts: ImportOptions, manifest: Manifest, admins: Set<string>): Kontext {
  let newsletterOrg: string | undefined;
  let jeKonto = new Map<string, string[]>();
  return {
    hasher: opts.hasher,
    secretBox: opts.secretBox,
    exportZeitpunkt: new Date(manifest.createdAt),
    plattformAdmins: admins,
    newsletterOrg: () => newsletterOrg as string,
    organisationenJeKonto: () => jeKonto,
    bericht: { zaehler: new Map(), abgebildet: new Map() },
    async vorbereiten(tabelle: string): Promise<void> {
      if (tabelle === 'newsletter_config') {
        const orgs = (await db.query<{ id: string }>('SELECT id FROM organizations ORDER BY id')).rows.map((r) => r.id);
        if (opts.newsletterOrgId) {
          if (!orgs.includes(opts.newsletterOrgId)) throw new MigrationError('NEWSLETTER_ORG_AMBIGUOUS', 'Die mit --newsletter-org angegebene Organisation gibt es im Ziel nicht');
          newsletterOrg = opts.newsletterOrgId;
        } else if (orgs.length === 1) newsletterOrg = orgs[0];
        else throw new MigrationError('NEWSLETTER_ORG_AMBIGUOUS', `Die alte Newsletter-Konfiguration war global, das Ziel hat ${orgs.length} Organisationen: --newsletter-org <uuid> angeben`);
      }
      if (tabelle === 'feedback_submissions') {
        const { rows } = await db.query<{ user_id: string; orgs: string[] }>('SELECT user_id, array_agg(DISTINCT organization_id) AS orgs FROM members WHERE user_id IS NOT NULL AND organization_id IS NOT NULL GROUP BY user_id');
        jeKonto = new Map(rows.map((r) => [r.user_id, r.orgs]));
      }
    },
  };
}

function uebernehme(bericht: ImportBericht, kontext: Kontext): void {
  bericht.transformations = Object.fromEntries(kontext.bericht.zaehler);
  bericht.mappedValues = Object.fromEntries([...kontext.bericht.abgebildet].map(([k, v]) => [k, [...v].sort()]));
}

// --- Checkpoint --------------------------------------------------------------------------------------------------

const leerCheckpoint = (sha: string): Checkpoint => ({ manifestSha256: sha, tables: [], storageDone: false });

/** Ein Checkpoint gilt für genau ein Ziel (Host, Port, Datenbank): derselbe Export kann in mehrere Ziele importiert werden. */
function checkpointName(targetUrl: string): string {
  const u = new URL(targetUrl);
  return `import-checkpoint-${createHash('sha256').update(`${u.hostname}:${u.port}${u.pathname}`).digest('hex').slice(0, 12)}.json`;
}

async function ladeCheckpoint(pfad: string, sha: string): Promise<Checkpoint> {
  const roh = await readFile(pfad, 'utf8').catch(() => null);
  if (roh === null) return leerCheckpoint(sha);
  const cp = JSON.parse(roh) as Checkpoint;
  if (cp.manifestSha256 !== sha) throw new MigrationError('CHECKPOINT_MISMATCH', 'Der Checkpoint gehört zu einem anderen Export (Manifest geändert). Ziel leeren und die Checkpoint-Datei löschen.');
  return cp;
}

/** Ein Checkpoint darf nie überspringen, was im Ziel nicht (mehr) vorhanden ist, z. B. nach neu angelegter Datenbank. */
async function pruefeCheckpointGegenZiel(db: Client, cp: Checkpoint, manifest: Manifest): Promise<void> {
  for (const name of cp.tables) {
    const erwartet = manifest.tables.find((t) => t.table === name)?.exportedRows ?? 0;
    const { rows } = await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM ${relation(name)}`);
    if (rows[0].n !== erwartet) {
      throw new MigrationError('CHECKPOINT_MISMATCH', `Der Checkpoint führt ${name} als importiert (${erwartet} Zeilen), das Ziel enthält ${rows[0].n}. Ziel leeren und die Checkpoint-Datei löschen.`);
    }
  }
}

// --- Dateiinhalte ------------------------------------------------------------------------------------------------

async function kopiereDateien(manifest: Manifest, opts: ImportOptions, dry: boolean): Promise<ImportBericht['storage']> {
  const ergebnis = { copied: 0, alreadyPresent: 0, missingInExport: manifest.storage.missing.map((m) => m.fileId) };
  for (const objekt of manifest.storage.objects) {
    const quelle = join(opts.exportDir, objekt.file);
    const gelesen = await sha256Datei(quelle).catch(() => {
      throw new MigrationError('EXPORT_CORRUPT', `Dateiinhalt ${objekt.file} fehlt im Export`);
    });
    if (gelesen.sha256 !== objekt.sha256 || gelesen.size !== objekt.size) throw new MigrationError('EXPORT_CORRUPT', `Dateiinhalt ${objekt.file} stimmt nicht mit dem Manifest überein`);
    if (dry) continue;

    const ziel = join(opts.filesDir, objekt.organizationId, objekt.fileId);
    const vorhanden = await stat(ziel).then(() => sha256Datei(ziel), () => null);
    if (vorhanden && vorhanden.sha256 === objekt.sha256) {
      ergebnis.alreadyPresent += 1;
      continue;
    }
    await mkdir(join(opts.filesDir, objekt.organizationId), { recursive: true });
    const temp = `${ziel}.${randomUUID()}.tmp`;
    try {
      await copyFile(quelle, temp);
      if ((await sha256Datei(temp)).sha256 !== objekt.sha256) throw new MigrationError('EXPORT_CORRUPT', `Kopie von ${objekt.file} beschädigt`);
      await rename(temp, ziel);
    } finally {
      await rm(temp, { force: true });
    }
    ergebnis.copied += 1;
  }
  return ergebnis;
}
