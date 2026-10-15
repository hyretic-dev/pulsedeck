import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { compareSync, hashSync } from 'bcryptjs';
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { BcryptPasswordHasher } from '../auth/password-hasher';
import { SecretBox } from '../common/secret-box';
import { newsletterKontext } from '../newsletter/org-smtp';
import { ADMIN_URL, createTestDatabase, dropTestDatabase } from '../../test/pg-test-db';
// @ts-expect-error – .mjs ohne Typdeklaration
import { replayLegacy } from '../../scripts/legacy-replay/replay.mjs';
import { MigrationError } from './errors';
import { exportiere } from './exporter';
import { importiere, type ImportOptions } from './importer';
import { liesManifest, type Manifest } from './manifest';
import { NICHT_UEBERNOMMEN, TABLES } from './tables';
import { validiere } from './validator';

const LEGACY_DB = 'migration_legacy';
const KEEP = process.env.MIGRATION_KEEP;
const SCHLUESSEL = new SecretBox(Buffer.alloc(32, 7));
const hasher = new BcryptPasswordHasher();
const id = (n: number): string => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const urlFuer = (db: string): string => ADMIN_URL.replace(/\/[^/]*$/, `/${db}`);
const migrationsUrl = (db: string): string => `postgres://pulsedeck_migrations:migrations-test@127.0.0.1:5433/${db}`;

const U = { olga: id(1), neu: id(2), gesperrt: id(3), geloescht: id(4), telefon: id(5) };
const O = { eins: id(101), zwei: id(102) };

let arbeitsDir: string;
let storageDir: string;
let exportDir: string;
let manifest: Manifest;
const ziele: string[] = [];

async function legacy<T extends object = Record<string, unknown>>(sql: string, werte: unknown[] = []): Promise<T[]> {
  const c = new Client({ connectionString: urlFuer(LEGACY_DB) });
  await c.connect();
  try {
    return (await c.query(sql, werte)).rows as T[];
  } finally {
    await c.end();
  }
}

/** Repräsentativer Bestand: mehrere Organisationen, ein Konto in zwei Organisationen, Altlasten, die Umwandlung brauchen. */
async function saeLegacy(): Promise<void> {
  const c = new Client({ connectionString: urlFuer(LEGACY_DB) });
  await c.connect();
  try {
    await c.query('SET session_replication_role = replica'); // Trigger (Standardrollen, Audit) aus: der Bestand soll genau so aussehen, wie hier geschrieben
    const pw = hashSync('altes-passwort', 4);
    await c.query(
      `INSERT INTO auth.users (id, email, encrypted_password, email_confirmed_at, banned_until, deleted_at, created_at) VALUES
        ($1, 'Olga.Owner@Example.org ', $6, '2026-01-02 10:00:00.123456+00', NULL, NULL, '2026-01-01 09:00:00.654321+00'),
        ($2, 'noch.neu@example.org', '', NULL, NULL, NULL, '2026-02-01 09:00:00+00'),
        ($3, 'gesperrt@example.org', $6, '2026-01-05 10:00:00+00', now() + interval '1 year', NULL, '2026-01-03 09:00:00+00'),
        ($4, 'weg@example.org', $6, '2026-01-05 10:00:00+00', NULL, now(), '2026-01-04 09:00:00+00'),
        ($5, NULL, NULL, NULL, NULL, NULL, '2026-01-05 09:00:00+00')`,
      [U.olga, U.neu, U.gesperrt, U.geloescht, U.telefon, pw]
    );
    await c.query("INSERT INTO auth.identities (user_id, provider) VALUES ($1, 'email'), ($2, 'google')", [U.olga, U.neu]);
    await c.query(`INSERT INTO organizations (id, slug, name, owner_id, created_at) VALUES ($1, 'verein-eins', 'Verein Eins', $3, '2026-01-10 08:00:00.5+00'), ($2, 'verein-zwei', 'Verein Zwei', $3, '2026-01-11 08:00:00+00')`, [O.eins, O.zwei, U.olga]);
    await c.query(
      `INSERT INTO organization_roles (id, organization_id, name, permissions, is_system_admin, is_default) VALUES
        ($1, $4, 'Admin', ARRAY['all'], true, false), ($2, $4, 'Mitglied', ARRAY[]::text[], false, true), ($3, $5, 'Admin', ARRAY['all'], true, false)`,
      [id(201), id(202), id(203), O.eins, O.zwei]
    );
    await c.query(
      `INSERT INTO members (id, organization_id, user_id, role_id, name, status, email, join_date, calendar_token, created_at) VALUES
        ($1, $5, $7, $9, 'Olga Owner', 'Active', 'Olga.Owner@example.org', '2026-01-10', 'cal-token-olga', '2026-01-10 08:30:00+00'),
        ($2, $5, $8, $10, 'Nele Neu', 'Active', 'noch.neu@example.org', '2026-02-01', NULL, now()),
        ($3, $6, $7, $11, 'Olga Owner', 'Active', 'olga.owner@example.org', '2026-01-11', NULL, now()),
        ($4, $5, $12, $10, 'Gerd Gesperrt', 'Active', 'gesperrt@example.org', '2026-01-05', NULL, now())`,
      [id(301), id(302), id(303), id(304), O.eins, O.zwei, U.olga, U.neu, id(201), id(202), id(203), U.gesperrt]
    );
    await c.query("INSERT INTO skills (id, organization_id, name, category) VALUES ($1, $2, 'Grillen', 'ability')", [id(401), O.eins]);
    await c.query("INSERT INTO working_groups (id, organization_id, name, description, lead, next_meeting, contact_type, contact_icon) VALUES ($1, $2, 'AG Technik', 'Technik', 'Olga', '', 'Discord', 'pi-discord')", [id(501), O.eins]);
    await c.query("INSERT INTO wiki_categories (id, organization_id, name) VALUES ($1, $2, 'Allgemein')", [id(601), O.eins]);
    await c.query("INSERT INTO wiki_docs (id, organization_id, title, description, content, last_updated, author, status, category) VALUES ($1, $2, 'Satzung', 'Die Satzung', '<p>Text</p>', '2026-01-12', 'Olga', 'Published', $3)", [id(701), O.eins, id(601)]);
    // Kind vor Elternteil: die Reihenfolge der Zeilen darf keine Rolle spielen
    await c.query("INSERT INTO folders (id, organization_id, name, parent_id) VALUES ($1, $3, 'Protokolle', $2), ($2, $3, 'Dokumente', NULL)", [id(801), id(802), O.eins]);
    await c.query(
      `INSERT INTO files (id, organization_id, name, original_name, storage_path, mime_type, size_bytes, folder_id, visibility, is_indexed, uploaded_by) VALUES
        ($1, $5, 'protokoll.txt', 'protokoll.txt', 'verein-eins/protokolle/protokoll.txt', 'text/plain', 24, $6, 'member', true, $7),
        ($2, $5, 'logo.png', 'logo.png', '/logo.png', 'image/png', 8, NULL, 'public', false, $7),
        ($3, NULL, 'waise.txt', 'waise.txt', 'waise.txt', 'text/plain', 5, NULL, 'member', false, NULL),
        ($4, $8, 'vz.txt', 'vz.txt', 'verein-zwei/vz.txt', 'text/plain', 9999, NULL, 'admin', false, NULL)`,
      [id(901), id(902), id(903), id(904), O.eins, id(801), id(301), O.zwei]
    );
    await c.query("INSERT INTO events (id, organization_id, title, date, start_time, location, recurrence_parent_id, is_recurring) VALUES ($1, $3, 'Sitzung', '2026-03-01', '19:00', 'Vereinsheim', $2, true), ($2, $3, 'Sitzung', '2026-02-01', '19:00', 'Vereinsheim', NULL, true)", [id(1001), id(1002), O.eins]);
    await c.query("INSERT INTO event_slots (id, organization_id, event_id, title) VALUES ($1, $2, $3, 'Aufbau')", [id(1101), O.eins, id(1002)]);
    await c.query("INSERT INTO event_slot_signups (id, organization_id, slot_id, member_id, status) VALUES ($1, $2, $3, $4, 'confirmed')", [id(1201), O.eins, id(1101), id(301)]);
    await c.query("INSERT INTO feed_items (id, organization_id, title, content, author_id, type, status) VALUES ($1, $2, 'Hallo', '<p>Welt</p>', $3, 'article', 'approved')", [id(1301), O.eins, id(301)]);
    await c.query("INSERT INTO knowledge_base (id, organization_id, title, content, file_id, embedding) VALUES ($1, $3, 'Protokoll', 'Inhalt', $4, (SELECT array_agg(random()::float4) FROM generate_series(1, 1024))::vector), ($2, $3, 'Wiki', 'Inhalt', NULL, (SELECT array_agg(random()::float4) FROM generate_series(1, 1024))::vector)", [id(1401), id(1402), O.eins, id(901)]);
    await c.query("INSERT INTO newsletter_config (id, frequency, active, smtp_host, smtp_port, smtp_user, smtp_pass, smtp_from, smtp_secure) VALUES (1, 'weekly', true, 'smtp.example.org', 587, 'versand', 'geheim', 'news@example.org', false)");
    await c.query(
      `INSERT INTO feedback_submissions (id, type, description, user_id, status) VALUES
        ($1, 'bug', 'Zwei Organisationen', $4, 'new'), ($2, 'idee', 'Unbekannter Typ', $5, 'open'), ($3, 'suggestion', 'Ohne Status', $6, NULL)`,
      [id(1501), id(1502), id(1503), U.olga, U.gesperrt, U.neu]
    );
    await c.query('INSERT INTO chat_sessions (id, user_id, organization_id) VALUES ($1, $2, $3)', [id(1601), U.olga, O.eins]);
    await c.query("INSERT INTO chat_messages (id, session_id, role, content) VALUES ($1, $2, 'user', 'Hallo')", [id(1602), id(1601)]);
    await c.query("INSERT INTO audit_logs (id, table_name, operation, organization_id, created_at) VALUES ($1, 'members', 'INSERT', $2, '2026-01-10 08:30:00.111111+00')", [id(1701), O.eins]);
    await c.query("INSERT INTO analytics_events (id, event_name, organization_id) VALUES ($1, 'page_view', $2)", [id(1801), O.eins]);
    await c.query("INSERT INTO contacts (id, organization_id, name, role, description, email, location) VALUES ($1, $2, 'Max', 'Kassenwart', 'Kasse', 'max@example.org', 'Köln')", [id(1901), O.eins]);
    await c.query("INSERT INTO active_sessions (user_id, name) VALUES ($1, 'Olga')", [U.olga]);
    // im Bestand angelegt, steht aber in keiner Repo-Migration (Dashboard-Tabelle)
    await c.query('CREATE TABLE public.push_subscriptions (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), member_id uuid NOT NULL REFERENCES members (id) ON DELETE CASCADE, endpoint text NOT NULL, p256dh text NOT NULL, auth text NOT NULL, created_at timestamptz DEFAULT now())');
    await c.query("INSERT INTO push_subscriptions (id, member_id, endpoint, p256dh, auth) VALUES ($1, $2, 'https://push.example.org/abc', 'p256', 'authkey')", [id(2001), id(301)]);
  } finally {
    await c.end();
  }
}

async function schreibeBinaerdateien(): Promise<void> {
  const dateien: Record<string, Buffer> = {
    'verein-eins/protokolle/protokoll.txt': Buffer.from('Protokoll der Sitzung 1\n'),
    'logo.png': Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 1, 2, 3]), // in der Datenbank mit führendem „/“ (so in Produktion)
    'verein-zwei/vz.txt': Buffer.from('Vereinzwei'),
    'waise.txt': Buffer.from('waise'),
  };
  for (const [pfad, inhalt] of Object.entries(dateien)) {
    await mkdir(join(storageDir, 'files', pfad, '..'), { recursive: true });
    await writeFile(join(storageDir, 'files', pfad), inhalt);
  }
}

async function frischesZiel(name: string): Promise<{ url: string; filesDir: string; opts: ImportOptions }> {
  await createTestDatabase(name);
  ziele.push(name);
  const filesDir = await mkdtemp(join(arbeitsDir, 'files-'));
  return {
    url: migrationsUrl(name),
    filesDir,
    opts: {
      exportDir,
      targetUrl: migrationsUrl(name),
      filesDir,
      secretBox: SCHLUESSEL,
      hasher,
      platformAdminIds: [U.olga],
      newsletterOrgId: O.eins,
    },
  };
}

async function ziel<T extends object = Record<string, unknown>>(name: string, sql: string, werte: unknown[] = []): Promise<T[]> {
  const c = new Client({ connectionString: urlFuer(name) });
  await c.connect();
  try {
    return (await c.query(sql, werte)).rows as T[];
  } finally {
    await c.end();
  }
}

const sha = (inhalt: Buffer | string): string => createHash('sha256').update(inhalt).digest('hex');

describe('Migrationswerkzeug (Supabase-Bestand → NestJS/PostgreSQL)', () => {
  beforeAll(async () => {
    // MIGRATION_KEEP=<verzeichnis>: Altbestand, Storage und Export für die Probe im Compose-Stack behalten (siehe docs/betrieb/migration.md)
    arbeitsDir = KEEP ? KEEP : await mkdtemp(join(tmpdir(), 'pulsedeck-migration-'));
    await mkdir(arbeitsDir, { recursive: true });
    storageDir = join(arbeitsDir, 'supabase-storage');
    exportDir = join(arbeitsDir, 'export');
    const fehler = await replayLegacy(ADMIN_URL, LEGACY_DB);
    expect(fehler).toEqual([]);
    await saeLegacy();
    await schreibeBinaerdateien();
    manifest = await exportiere({ sourceUrl: urlFuer(LEGACY_DB), outDir: exportDir, storageDir });
  }, 120_000);

  afterAll(async () => {
    for (const name of KEEP ? ziele : [LEGACY_DB, ...ziele]) await dropTestDatabase(name).catch(() => undefined);
    if (!KEEP) await rm(arbeitsDir, { recursive: true, force: true });
  });

  describe('Export', () => {
    it('schreibt ein Manifest mit Zeilenzahlen, begründeten Ausschlüssen, Prüfsummen und Vorabprüfung', () => {
      const je = Object.fromEntries(manifest.tables.map((t) => [t.table, t]));
      expect(je.auth_users).toMatchObject({ sourceRows: 5, exportedRows: 3, excluded: { rows: 2 } });
      expect(je.auth_users.excluded?.reason).toMatch(/gelöschte Konten/);
      expect(je.files).toMatchObject({ sourceRows: 4, exportedRows: 3, excluded: { rows: 1 } });
      expect(je.knowledge_base).toMatchObject({ sourceRows: 2, exportedRows: 1, excluded: { rows: 1 } });
      expect(je.members.exportedRows).toBe(4);
      expect(je.members.perOrg).toEqual({ [O.eins]: 3, [O.zwei]: 1 });
      expect(je.push_subscriptions.exportedRows).toBe(1);
      expect(manifest.tables.every((t) => /^[0-9a-f]{32}$/.test(t.checksum) || t.missingInSource)).toBe(true);
      expect(manifest.source.serverVersion).toMatch(/^\d+/);
      expect(manifest.source.extensions).toContain('vector');
      expect(manifest.source.authProviders).toEqual({ email: 1, google: 1 });
      expect(manifest.skippedTables).toHaveProperty('active_sessions');
      expect(manifest.storage).toMatchObject({ included: true, missing: [] });
      expect(manifest.storage.objects).toHaveLength(3);
    });

    it('exportiert von auth.users nur die nötigen Spalten, nie Tokens oder Metadaten', async () => {
      const zeile = JSON.parse((await readFile(join(exportDir, 'auth_users.ndjson'), 'utf8')).split('\n')[0]) as Record<string, unknown>;
      expect(Object.keys(zeile).sort()).toEqual(['banned_until', 'created_at', 'deleted_at', 'email', 'email_confirmed_at', 'encrypted_password', 'id', 'updated_at']);
    });

    it('legt die Dateiinhalte mit SHA-256 ab und bricht bei fehlenden Inhalten mit eigenem Code ab', async () => {
      const objekt = manifest.storage.objects.find((o) => o.fileId === id(901));
      expect(objekt).toMatchObject({ organizationId: O.eins, sha256: sha('Protokoll der Sitzung 1\n') });
      const leer = await mkdtemp(join(arbeitsDir, 'leer-'));
      const out = join(arbeitsDir, 'export-fehlend');
      await expect(exportiere({ sourceUrl: urlFuer(LEGACY_DB), outDir: out, storageDir: leer })).rejects.toMatchObject({ code: 'STORAGE_OBJECT_MISSING' });
      const m = await liesManifest(out);
      expect(m.manifest.storage.missing).toHaveLength(3); // fehlende Objekte stehen trotzdem im Manifest
      await expect(exportiere({ sourceUrl: urlFuer(LEGACY_DB), outDir: join(arbeitsDir, 'export-erlaubt'), storageDir: leer, allowMissingObjects: true })).resolves.toBeDefined();
    });

    it('liest storage_path mit führendem „/“ (so in Produktion) und weist Pfade außerhalb des Buckets ab', async () => {
      expect(manifest.storage.objects.some((o) => o.sourcePath === '/logo.png' && o.fileId === id(902))).toBe(true);

      // Ein Pfad aus der Datenbank darf nie aus dem Bucket-Verzeichnis herausführen („/../“ beginnt mit „/“ und wird zu „../“)
      await writeFile(join(storageDir, 'ausserhalb.txt'), 'geheim');
      await legacy('ALTER TABLE public.files DISABLE TRIGGER USER');
      await legacy("INSERT INTO files (id, organization_id, name, original_name, storage_path, visibility) VALUES ($1, $2, 'x', 'x', '/../ausserhalb.txt', 'member')", [id(950), O.eins]);
      try {
        const m = await exportiere({ sourceUrl: urlFuer(LEGACY_DB), outDir: join(arbeitsDir, 'export-traversal'), storageDir, allowMissingObjects: true });
        expect(m.storage.missing.map((x) => x.fileId)).toEqual([id(950)]);
        expect(m.storage.objects.map((o) => o.fileId)).not.toContain(id(950));
      } finally {
        await legacy('DELETE FROM public.files WHERE id = $1', [id(950)]);
        await legacy('ALTER TABLE public.files ENABLE TRIGGER USER');
      }
    });

    it('beschränkt den Export auf eine Organisation: nur ihre Daten, die Konten ihrer Mitglieder und ausdrücklich behaltene Konten', async () => {
      const m = await exportiere({ sourceUrl: urlFuer(LEGACY_DB), outDir: join(arbeitsDir, 'export-zwei'), storageDir, onlyOrg: 'verein-zwei', keepAccounts: [U.gesperrt] });
      const je = Object.fromEntries(m.tables.map((t) => [t.table, t]));
      expect(m.scope).toMatchObject({ slug: 'verein-zwei', organizationId: O.zwei, keepAccounts: [U.gesperrt] });
      expect(je.organizations).toMatchObject({ sourceRows: 2, exportedRows: 1 });
      expect(je.organizations.excluded?.reason).toMatch(/andere Organisationen/);
      expect(je.members.exportedRows).toBe(1); // Olga in Verein Zwei
      expect(je.auth_users.exportedRows).toBe(2); // Olga (Mitglied, Besitzerin) + das ausdrücklich behaltene Konto
      expect(je.events.exportedRows).toBe(0);
      expect(je.wiki_docs.exportedRows).toBe(0);
      expect(je.knowledge_base.exportedRows).toBe(0); // der Chunk gehört zu Verein Eins
      expect(je.files.exportedRows).toBe(1);
      expect(je.feedback_submissions.exportedRows).toBe(2); // Beiträge der enthaltenen Konten; das Konto „Neu“ ist nicht dabei
      expect(je.newsletter_config.exportedRows).toBe(1); // global, wird der einzigen Organisation zugeordnet
      expect(je.members.perOrg).toEqual({ [O.zwei]: 1 });
      expect(m.storage.objects.map((o) => o.fileId)).toEqual([id(904)]);
      await expect(exportiere({ sourceUrl: urlFuer(LEGACY_DB), outDir: join(arbeitsDir, 'export-unbekannt-org'), storageDir, onlyOrg: 'gibt-es-nicht' })).rejects.toMatchObject({ code: 'USAGE' });
    });

    it('bricht ab, wenn die Quelle Tabellen hat, die weder übernommen noch begründet ausgelassen sind (nichts fällt still weg)', async () => {
      await legacy('CREATE TABLE public.dashboard_only (id uuid PRIMARY KEY, notiz text)');
      await legacy("INSERT INTO public.dashboard_only VALUES (gen_random_uuid(), 'wichtig'), (gen_random_uuid(), 'auch wichtig')");
      try {
        const fehler = await exportiere({ sourceUrl: urlFuer(LEGACY_DB), outDir: join(arbeitsDir, 'export-unbekannt'), storageDir }).catch((e: MigrationError) => e);
        expect(fehler).toMatchObject({ code: 'SCHEMA_DRIFT' });
        expect((fehler as Error).message).toContain('dashboard_only (2 Zeilen)');

        const erlaubt = await exportiere({ sourceUrl: urlFuer(LEGACY_DB), outDir: join(arbeitsDir, 'export-unbekannt-erlaubt'), storageDir, allowUnmapped: ['dashboard_only'] });
        expect(erlaubt.skippedTables.dashboard_only).toMatch(/Betreiber/);
        expect(erlaubt.skippedTables.active_sessions).toBeDefined(); // die bekannten Auslassungen bleiben erhalten
      } finally {
        await legacy('DROP TABLE public.dashboard_only');
      }
    });

    it('verweigert ein nicht leeres Exportverzeichnis und meldet Verbindungsfehler ohne Zugangsdaten', async () => {
      await expect(exportiere({ sourceUrl: urlFuer(LEGACY_DB), outDir: exportDir })).rejects.toMatchObject({ code: 'USAGE' });
      const fehler = await exportiere({ sourceUrl: 'postgres://nutzer:geheimes-passwort@127.0.0.1:1/x', outDir: join(arbeitsDir, 'export-x') }).catch((e: MigrationError) => e);
      expect(fehler).toMatchObject({ code: 'SOURCE_CONNECT' });
      expect((fehler as Error).message).not.toContain('geheimes-passwort');
    });
  });

  describe('Registry', () => {
    it('Reihenfolge erfüllt alle Fremdschlüssel; jede Zieltabelle ist übernommen oder bewusst neu', async () => {
      const name = 'migration_registry';
      await createTestDatabase(name);
      ziele.push(name);
      const fks = await ziel<{ kind: string; eltern: string }>(
        name,
        "SELECT conrelid::regclass::text AS kind, confrelid::regclass::text AS eltern FROM pg_constraint WHERE contype = 'f' AND connamespace = 'public'::regnamespace"
      );
      const position = new Map(TABLES.map((t, i) => [t.table, i]));
      for (const fk of fks) {
        if (!position.has(fk.kind)) continue; // nur neue Betriebstabellen (Outbox, Tokens …)
        if (fk.kind === fk.eltern) continue; // Selbstbezug wird nachträglich gesetzt
        expect(position.get(fk.eltern), `${fk.kind} → ${fk.eltern}`).toBeLessThan(position.get(fk.kind) as number);
      }
      const tabellen = (await ziel<{ t: string }>(name, "SELECT table_name AS t FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE'")).map((r) => r.t);
      const neu = ['active_sessions', 'index_jobs', 'mail_outbox', 'pgmigrations', 'push_notification_queue', 'rate_limits', 'refresh_tokens', 'scheduler_state', 'verification_tokens'];
      const uebernommen = new Set(TABLES.map((t) => t.table));
      expect(tabellen.filter((t) => !uebernommen.has(t)).sort()).toEqual(neu);
      expect(Object.keys(NICHT_UEBERNOMMEN)).toEqual(['active_sessions']); // bewusst weggelassen, mit Begründung
      expect([...uebernommen].filter((t) => !tabellen.includes(t))).toEqual([]);
    }, 60_000);
  });

  describe('Import', () => {
    it('Probelauf prüft alles gegen das echte Zielschema und schreibt nichts', async () => {
      const z = await frischesZiel('migration_dry');
      const bericht = await importiere({ ...z.opts, dryRun: true });
      expect(bericht.status).toBe('dry-run-ok');
      expect(bericht.tables.members).toMatchObject({ exported: 4, inserted: 4 });
      for (const t of ['auth_users', 'members', 'files', 'newsletter_config']) expect((await ziel<{ n: number }>('migration_dry', `SELECT count(*)::int AS n FROM ${t}`))[0].n, t).toBe(0);
      expect(existsSync(join(exportDir, 'import-checkpoint.json'))).toBe(false);
      expect(existsSync(join(z.filesDir, O.eins))).toBe(false);
    }, 120_000);

    it('importiert vollständig, wandelt Werte wie dokumentiert um und besteht die Validierung', async () => {
      const z = await frischesZiel('migration_voll');
      const bericht = await importiere(z.opts);
      expect(bericht.status).toBe('complete');
      expect(bericht.storage).toMatchObject({ copied: 3, alreadyPresent: 0 });

      // Konten: bcrypt-Hash aus Supabase bleibt gültig, E-Mail normalisiert, Sperre/Bestätigung/Plattform-Admin übertragen
      const konten = await ziel<{ id: string; email: string; password_hash: string; password_set: boolean; email_verified: boolean; is_blocked: boolean; is_platform_admin: boolean }>('migration_voll', 'SELECT * FROM auth_users ORDER BY id');
      expect(konten.map((k) => k.email)).toEqual(['olga.owner@example.org', 'noch.neu@example.org', 'gesperrt@example.org']);
      const olga = konten[0];
      expect(compareSync('altes-passwort', olga.password_hash)).toBe(true);
      expect(olga).toMatchObject({ password_set: true, email_verified: true, is_blocked: false, is_platform_admin: true });
      expect(konten[1]).toMatchObject({ password_set: false, email_verified: false, is_blocked: false, is_platform_admin: false });
      expect(compareSync('', konten[1].password_hash)).toBe(false);
      expect(konten[2]).toMatchObject({ is_blocked: true, email_verified: true });
      expect(bericht.transformations['auth_users: Konto ohne Passwort-Hash → unbenutzbarer Hash, passwordSet=false']).toBe(1);

      // Ein Konto, zwei Organisationen; Zeitstempel mit Mikrosekunden bleiben erhalten
      expect((await ziel<{ n: number }>('migration_voll', 'SELECT count(*)::int AS n FROM members WHERE user_id = $1', [U.olga]))[0].n).toBe(2);
      expect((await ziel<{ t: string }>('migration_voll', "SELECT to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS.US') AS t FROM auth_users WHERE id = $1", [U.olga]))[0].t).toBe('2026-01-01 09:00:00.654321');
      expect((await ziel<{ calendar_token: string }>('migration_voll', 'SELECT calendar_token FROM members WHERE id = $1', [id(301)]))[0].calendar_token).toBe('cal-token-olga');

      // Selbstbezüge unabhängig von der Zeilenreihenfolge
      expect((await ziel<{ parent_id: string }>('migration_voll', 'SELECT parent_id FROM folders WHERE id = $1', [id(801)]))[0].parent_id).toBe(id(802));
      expect((await ziel<{ recurrence_parent_id: string }>('migration_voll', 'SELECT recurrence_parent_id FROM events WHERE id = $1', [id(1001)]))[0].recurrence_parent_id).toBe(id(1002));

      // Newsletter: Singleton → Organisation, Klartext-Passwort → verschlüsselt und nur mit passendem Kontext lesbar
      const [news] = await ziel<{ organization_id: string; smtp_pass_encrypted: string; smtp_host: string }>('migration_voll', 'SELECT * FROM newsletter_config');
      expect(news).toMatchObject({ organization_id: O.eins, smtp_host: 'smtp.example.org' });
      expect(news.smtp_pass_encrypted).not.toContain('geheim');
      expect(SCHLUESSEL.open(news.smtp_pass_encrypted, newsletterKontext(O.eins))).toBe('geheim');
      expect(() => SCHLUESSEL.open(news.smtp_pass_encrypted, newsletterKontext(O.zwei))).toThrow();

      // Dateien: Schlüssel <org>/<id>, Inhalte im Volume, Wissensbasis mit Dateibezug und Vektoren
      const [datei] = await ziel<{ storage_path: string }>('migration_voll', 'SELECT storage_path FROM files WHERE id = $1', [id(901)]);
      expect(datei.storage_path).toBe(`${O.eins}/${id(901)}`);
      expect(sha(await readFile(join(z.filesDir, O.eins, id(901))))).toBe(sha('Protokoll der Sitzung 1\n'));
      const [kb] = await ziel<{ source_type: string; source_id: string; dims: number }>('migration_voll', 'SELECT source_type, source_id, vector_dims(embedding) AS dims FROM knowledge_base');
      expect(kb).toEqual({ source_type: 'file', source_id: id(901), dims: 1024 });

      // Feedback: Werte auf die neuen Mengen abgebildet, Organisation nur bei eindeutiger Mitgliedschaft
      const fb = await ziel<{ id: string; type: string; status: string; organization_id: string | null }>('migration_voll', 'SELECT id, type, status, organization_id FROM feedback_submissions ORDER BY id');
      expect(fb).toEqual([
        { id: id(1501), type: 'bug', status: 'new', organization_id: null }, // Olga: zwei Organisationen
        { id: id(1502), type: 'suggestion', status: 'new', organization_id: O.eins },
        { id: id(1503), type: 'suggestion', status: 'new', organization_id: O.eins },
      ]);
      expect(bericht.mappedValues).toMatchObject({ 'feedback_submissions.type': ['idee'], 'feedback_submissions.status': ['null', 'open'] });

      // Nicht übernommene Tabelle und optionale Dashboard-Tabelle
      expect((await ziel<{ n: number }>('migration_voll', 'SELECT count(*)::int AS n FROM active_sessions'))[0].n).toBe(0);
      expect((await ziel<{ endpoint: string }>('migration_voll', 'SELECT endpoint FROM push_subscriptions'))[0].endpoint).toBe('https://push.example.org/abc');

      const validierung = await validiere({ exportDir, targetUrl: z.url, filesDir: z.filesDir });
      expect(validierung.pruefungen.filter((p) => !p.ok)).toEqual([]);
      expect(validierung.ok).toBe(true);
      expect(validierung.pruefungen.length).toBeGreaterThan(60);

      // zweiter Lauf desselben Exports ins selbe Ziel: Checkpoint → nichts passiert, keine Duplikate
      const nochmal = await importiere(z.opts);
      expect(nochmal.status).toBe('complete');
      expect(Object.values(nochmal.tables).every((t) => t.skippedByCheckpoint)).toBe(true);
      expect((await ziel<{ n: number }>('migration_voll', 'SELECT count(*)::int AS n FROM members'))[0].n).toBe(4);
    }, 180_000);

    it('meldet einen Abbruch mit Fehlercode, hält den Stand im Checkpoint und lässt sich nach Behebung fortsetzen', async () => {
      const z = await frischesZiel('migration_abbruch');
      // CHECK, der den Bestand verletzt: members scheitert, auth_users/organizations/organization_roles sind schon committed
      await ziel('migration_abbruch', "ALTER TABLE members ADD CONSTRAINT nur_test CHECK (name <> 'Gerd Gesperrt')");
      const fehler = await importiere(z.opts).catch((e: MigrationError) => e);
      expect(fehler).toMatchObject({ code: 'CONSTRAINT_VIOLATION' });
      expect((fehler as Error).message).toContain('nur_test');
      expect((fehler as Error).message).not.toContain('Gerd'); // keine Personendaten in der Meldung

      const bericht = JSON.parse(await readFile(join(exportDir, 'import-report.json'), 'utf8')) as { status: string; failure: { code: string } };
      expect(bericht).toMatchObject({ status: 'failed', failure: { code: 'CONSTRAINT_VIOLATION' } });
      expect((await ziel<{ n: number }>('migration_abbruch', 'SELECT count(*)::int AS n FROM members'))[0].n).toBe(0); // Tabelle atomar zurückgerollt
      expect((await ziel<{ n: number }>('migration_abbruch', 'SELECT count(*)::int AS n FROM organizations'))[0].n).toBe(2); // Vorheriges bleibt
      expect(existsSync(join(z.filesDir, O.eins))).toBe(false); // Dateien erst nach allen Tabellen

      await ziel('migration_abbruch', 'ALTER TABLE members DROP CONSTRAINT nur_test');
      const fertig = await importiere(z.opts);
      expect(fertig).toMatchObject({ status: 'complete', tables: { organizations: { skippedByCheckpoint: true }, members: { inserted: 4 } } });
      expect(fertig.storage.copied).toBe(3);
      expect((await validiere({ exportDir, targetUrl: z.url, filesDir: z.filesDir })).ok).toBe(true);
    }, 120_000);

    it('überspringt nie, was im Ziel fehlt: ein Checkpoint zu neu angelegter Datenbank wird abgelehnt', async () => {
      const z = await frischesZiel('migration_abbruch'); // gleicher Name, jetzt leer – der Checkpoint von eben ist veraltet
      await expect(importiere(z.opts)).rejects.toMatchObject({ code: 'CHECKPOINT_MISMATCH' });
    }, 60_000);

    it('importiert einen auf eine Organisation beschränkten Export vollständig und besteht die Validierung (Newsletter-Zuordnung automatisch)', async () => {
      const gefiltert = join(arbeitsDir, 'export-zwei');
      if (!existsSync(gefiltert)) await exportiere({ sourceUrl: urlFuer(LEGACY_DB), outDir: gefiltert, storageDir, onlyOrg: 'verein-zwei', keepAccounts: [U.gesperrt] });
      const z = await frischesZiel('migration_scope');
      const bericht = await importiere({ ...z.opts, exportDir: gefiltert, newsletterOrgId: undefined, platformAdminIds: [U.olga] });
      expect(bericht.status).toBe('complete');
      const n = async (t: string): Promise<number> => (await ziel<{ n: number }>('migration_scope', `SELECT count(*)::int AS n FROM ${t}`))[0].n;
      expect([await n('organizations'), await n('members'), await n('auth_users'), await n('events'), await n('files'), await n('feedback_submissions')]).toEqual([1, 1, 2, 0, 1, 2]);
      expect((await ziel<{ organization_id: string }>('migration_scope', 'SELECT organization_id FROM newsletter_config'))[0].organization_id).toBe(O.zwei);
      expect((await validiere({ exportDir: gefiltert, targetUrl: z.url, filesDir: z.filesDir })).ok).toBe(true);
    }, 120_000);

    it('verweigert ein nicht leeres Ziel', async () => {
      const z = await frischesZiel('migration_belegt');
      await ziel('migration_belegt', "INSERT INTO auth_users (email, password_hash) VALUES ('vorhanden@example.org', 'x')");
      await expect(importiere(z.opts)).rejects.toMatchObject({ code: 'TARGET_NOT_EMPTY' });
    }, 60_000);

    it('lehnt einen beschädigten Export ab, bevor das Ziel berührt wird', async () => {
      const kaputt = join(arbeitsDir, 'export-kaputt');
      await cp(exportDir, kaputt, { recursive: true, filter: (quelle) => !quelle.includes('import-') });
      await writeFile(join(kaputt, 'members.ndjson'), `${await readFile(join(kaputt, 'members.ndjson'), 'utf8')} `);
      const z = await frischesZiel('migration_kaputt');
      await expect(importiere({ ...z.opts, exportDir: kaputt })).rejects.toMatchObject({ code: 'EXPORT_CORRUPT' });
      expect((await ziel<{ n: number }>('migration_kaputt', 'SELECT count(*)::int AS n FROM auth_users'))[0].n).toBe(0);

      // auch ein verändertes Dateiobjekt wird erkannt
      const kaputt2 = join(arbeitsDir, 'export-kaputt2');
      await cp(exportDir, kaputt2, { recursive: true, filter: (quelle) => !quelle.includes('import-') });
      await writeFile(join(kaputt2, 'storage', id(901)), 'manipuliert');
      await expect(importiere({ ...z.opts, exportDir: kaputt2 })).rejects.toMatchObject({ code: 'EXPORT_CORRUPT' });
    }, 60_000);

    it('verlangt Entscheidungen statt zu raten: Newsletter-Organisation, Geheimnis-Schlüssel, Plattform-Administrator', async () => {
      const z = await frischesZiel('migration_regeln');
      await expect(importiere({ ...z.opts, newsletterOrgId: undefined })).rejects.toMatchObject({ code: 'NEWSLETTER_ORG_AMBIGUOUS' });
      await ziel('migration_regeln', 'TRUNCATE auth_users CASCADE'); // Abbruchrest entfernen, Checkpoint passt nicht mehr
      await rm(join(exportDir, (await readdirNames(exportDir)).find((n) => n.startsWith('import-checkpoint')) as string), { force: true });
      await expect(importiere({ ...z.opts, secretBox: new SecretBox(null) })).rejects.toMatchObject({ code: 'MISSING_SECRET' });
      const z2 = await frischesZiel('migration_regeln2');
      await expect(importiere({ ...z2.opts, platformAdminIds: [id(4242)] })).rejects.toMatchObject({ code: 'UNKNOWN_PLATFORM_ADMIN' });
      expect((await ziel<{ n: number }>('migration_regeln2', 'SELECT count(*)::int AS n FROM auth_users'))[0].n).toBe(0);
    }, 120_000);

    it('erkennt Schemaabweichungen im Ziel', async () => {
      const z = await frischesZiel('migration_drift');
      await ziel('migration_drift', 'ALTER TABLE members DROP COLUMN calendar_token');
      await expect(importiere({ ...z.opts, dryRun: true })).rejects.toMatchObject({ code: 'SCHEMA_DRIFT' });
    }, 60_000);
  });

  describe('Validierung', () => {
    it('deckt Abweichungen auf: veränderte Inhalte, fehlende und beschädigte Dateien', async () => {
      const z = await frischesZiel('migration_pruefung');
      await importiere(z.opts);
      expect((await validiere({ exportDir, targetUrl: z.url, filesDir: z.filesDir })).ok).toBe(true);

      await ziel('migration_pruefung', "UPDATE members SET name = 'Manipuliert' WHERE id = $1", [id(302)]);
      await ziel('migration_pruefung', 'DELETE FROM contacts');
      await rm(join(z.filesDir, O.eins, id(902)));
      await writeFile(join(z.filesDir, O.eins, id(901)), 'anderer Inhalt');
      await mkdir(join(z.filesDir, O.zwei), { recursive: true });
      await writeFile(join(z.filesDir, O.zwei, id(7777)), 'verwaist');

      const bericht = await validiere({ exportDir, targetUrl: z.url, filesDir: z.filesDir });
      const fehlgeschlagen = bericht.pruefungen.filter((p) => !p.ok).map((p) => p.name);
      expect(bericht.ok).toBe(false);
      expect(fehlgeschlagen).toEqual(
        expect.arrayContaining(['members: Inhaltsprüfsumme', 'contacts: Zeilenzahl', 'contacts: Inhaltsprüfsumme', 'contacts: Zeilen je Organisation', expect.stringContaining('Dateien: Inhalte im Speicher'), 'Datei-Volume: keine Objekte ohne Metadaten'])
      );
      expect(fehlgeschlagen).not.toContain('members: Zeilenzahl');
    }, 120_000);
  });
});

async function readdirNames(dir: string): Promise<string[]> {
  return (await import('node:fs/promises')).readdir(dir);
}
