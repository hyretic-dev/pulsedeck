// Rekonstruiert die Struktur der früheren Supabase-Produktion aus dem Live-Dump vom Juni 2026 (Git 0d4978f). Die Eingaben
// liegen hier im Verzeichnis, damit der Replay (und die Tests des Migrationswerkzeugs) ohne Git-Historie laufen. Rezept:
//   1. Plattform-Stubs (stubs.sql)
//   2. Live-Dump (01-live-dump.sql) und die danach erschienene Storage-Policy-Migration (02-storage-policies.sql)
// Das Ergebnis entspricht der Produktionsstruktur (Spaltenabdruck gegen die Produktion am 2026-10-14: alle 31 Tabellen
// identisch); `feed_item_reads` und `feed_items.is_pinned` gab es dort nie, `push_subscriptions` ebenfalls nicht.
//
//   node scripts/legacy-replay/replay.mjs            (DB legacy_replay im Test-Container)
// Danach: docker exec pulsedeck-pg-test pg_dump -U postgres -d legacy_replay --schema-only --no-owner
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const HIER = import.meta.dirname ?? fileURLToPath(new URL('.', import.meta.url));

const schritte = [
  { name: 'Live-Dump (Git 0d4978f)', sql: () => readFileSync(join(HIER, '01-live-dump.sql'), 'utf8') },
  { name: 'storage_policies (Git 0d4978f)', sql: () => readFileSync(join(HIER, '02-storage-policies.sql'), 'utf8') },
];

/** Legt die Datenbank `dbName` neu an und spielt das Altschema ein. Gibt die Fehlermeldungen je Schritt zurück. */
export async function replayLegacy(adminUrl, dbName, protokoll = () => undefined) {
  const admin = new pg.Client({ connectionString: adminUrl });
  await admin.connect();
  await admin.query(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);
  await admin.query(`CREATE DATABASE ${dbName}`);
  await admin.end();

  const client = new pg.Client({ connectionString: adminUrl.replace(/\/[^/]*$/, `/${dbName}`) });
  await client.connect();
  const fehler = [];
  try {
    await client.query(readFileSync(join(HIER, 'stubs.sql'), 'utf8'));
    await client.query('CREATE EXTENSION IF NOT EXISTS vector WITH SCHEMA public');
    for (const schritt of schritte) {
      // pg_net/pg_cron sind im Replay nicht installierbar; die Stubs liefern net.* und cron.*
      const sql = schritt
        .sql()
        .replace(/CREATE EXTENSION IF NOT EXISTS "?(pg_net|pg_cron)"?[^;]*;/gi, '-- Extension im Replay durch Stub ersetzt');
      try {
        await client.query(sql);
        // Der Dump setzt search_path auf leer; folgende Migrationen erwarten den Standard.
        await client.query('RESET search_path');
        protokoll(`OK     ${schritt.name}`);
      } catch (e) {
        fehler.push(`${schritt.name}: ${e.message}${e.position ? ` (Position ${e.position})` : ''}`);
        protokoll(`FEHLER ${fehler[fehler.length - 1]}`);
      }
    }
  } finally {
    await client.end();
  }
  return fehler;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const adminUrl = process.env.TEST_ADMIN_DATABASE_URL ?? 'postgres://postgres:postgres@127.0.0.1:5433/postgres';
  const fehler = await replayLegacy(adminUrl, process.env.REPLAY_DB ?? 'legacy_replay', console.log);
  console.log(`\n${schritte.length} Schritte, ${fehler.length} Fehler`);
  process.exitCode = fehler.length === 0 ? 0 : 1;
}
