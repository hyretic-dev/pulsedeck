import { execFileSync } from 'node:child_process';
import { join } from 'node:path';

import { Client } from 'pg';

/**
 * Frische Test-Datenbank pro Spec-Datei im Test-Container (scripts/test-db-setup.mjs):
 * Rollen, DB mit Migrations-Rolle als Owner, Migrationen mit der Migrations-Rolle ausgeführt
 * (Migration-before-serve analog). Spec-Dateien laufen parallel, daher eigener DB-Name je Datei.
 */
export const ADMIN_URL =
  process.env.TEST_ADMIN_DATABASE_URL ?? 'postgres://postgres:postgres@127.0.0.1:5433/postgres';

const BACKEND_ROOT = join(import.meta.dirname, '..');

/** Host und Port des Test-Servers (aus ADMIN_URL), damit ein abweichender Port (TEST_ADMIN_DATABASE_URL) auch für die Rollen-URLs gilt. */
const SERVER = new URL(ADMIN_URL).host;

async function legeRolleAn(admin: Client, name: string, passwort: string): Promise<void> {
  try {
    await admin.query(`CREATE ROLE ${name} LOGIN PASSWORD '${passwort}'`);
  } catch (fehler) {
    // 42710 = Rolle existiert; 23505 = parallel von einer anderen Spec-Datei angelegt
    const code = (fehler as { code?: string }).code;
    if (code !== '42710' && code !== '23505') throw fehler;
  }
}

export interface TestDatabase {
  /** Superuser-Zugang zum Anlegen von Testdaten. */
  adminUrl: string;
  /** Eingeschränkte Runtime-Rolle, wie sie das Backend nutzt. */
  runtimeUrl: string;
  name: string;
}

export async function createTestDatabase(name: string): Promise<TestDatabase> {
  const admin = new Client({ connectionString: ADMIN_URL });
  await admin.connect();
  try {
    await legeRolleAn(admin, 'pulsedeck_migrations', 'migrations-test');
    await legeRolleAn(admin, 'pulsedeck_runtime', 'runtime-test');
    await admin.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
    await admin.query(`CREATE DATABASE ${name} OWNER pulsedeck_migrations`);
  } finally {
    await admin.end();
  }
  // pgvector braucht Superuser-Rechte (wie docker/postgres/10-roles.sh im Betrieb)
  const dbAdmin = new Client({ connectionString: ADMIN_URL.replace(/\/[^/]*$/, `/${name}`) });
  await dbAdmin.connect();
  try {
    await dbAdmin.query('CREATE EXTENSION IF NOT EXISTS vector');
  } finally {
    await dbAdmin.end();
  }

  execFileSync(
    'node',
    [join('node_modules', 'node-pg-migrate', 'bin', 'node-pg-migrate.js'), '-d', 'MIGRATIONS_DATABASE_URL', 'up'],
    {
      cwd: BACKEND_ROOT,
      env: {
        ...process.env,
        MIGRATIONS_DATABASE_URL: `postgres://pulsedeck_migrations:migrations-test@${SERVER}/${name}`,
      },
      stdio: 'pipe',
    }
  );

  return {
    name,
    adminUrl: ADMIN_URL.replace(/\/[^/]*$/, `/${name}`),
    runtimeUrl: `postgres://pulsedeck_runtime:runtime-test@${SERVER}/${name}`,
  };
}

export async function dropTestDatabase(name: string): Promise<void> {
  const admin = new Client({ connectionString: ADMIN_URL });
  await admin.connect();
  try {
    await admin.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
  } finally {
    await admin.end();
  }
}
