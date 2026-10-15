import { execFileSync } from 'node:child_process';
import { Client } from 'pg';

// Stellt sicher, dass für die DB-Integrationstests ein PostgreSQL erreichbar ist.
// Standard: vorhandener Container pulsedeck-pg-test (pgvector/pg17) oder Start desselben.
// In CI alternativ TEST_ADMIN_DATABASE_URL auf einen bereitgestellten Postgres zeigen lassen.

const ADMIN_URL =
  process.env.TEST_ADMIN_DATABASE_URL ??
  'postgres://postgres:postgres@127.0.0.1:5433/postgres';
const CONTAINER = 'pulsedeck-pg-test';

async function erreichbar() {
  try {
    const client = new Client({ connectionString: ADMIN_URL, connectionTimeoutMillis: 2000 });
    await client.connect();
    await client.end();
    return true;
  } catch {
    return false;
  }
}

export default async function () {
  if (await erreichbar()) return;

  const vorhanden = execFileSync('docker', ['ps', '-aq', '-f', `name=${CONTAINER}`], {
    encoding: 'utf8',
  }).trim();
  if (!vorhanden) {
    execFileSync('docker', [
      'run',
      '-d',
      '--name',
      CONTAINER,
      '-e',
      'POSTGRES_PASSWORD=postgres',
      '-p',
      '127.0.0.1:5433:5432',
      'pgvector/pgvector:pg17',
    ]);
  } else {
    const laufend = execFileSync('docker', ['inspect', '-f', '{{.State.Running}}', CONTAINER], {
      encoding: 'utf8',
    }).trim();
    if (laufend !== 'true') {
      execFileSync('docker', ['start', CONTAINER]);
    }
  }

  for (let versuch = 0; versuch < 30; versuch++) {
    if (await erreichbar()) return;
    await new Promise((aufloesen) => setTimeout(aufloesen, 1000));
  }
  throw new Error(
    'Test-PostgreSQL nicht erreichbar; Container-Start fehlgeschlagen oder Docker nicht verfügbar.'
  );
}
