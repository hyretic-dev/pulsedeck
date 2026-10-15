import { Logger } from '@nestjs/common';
import { Pool } from 'pg';

/** Begrenzter Pool für den Runtime-Zugang (keine Superuser-Verbindung). */
export const PG_POOL = Symbol('PG_POOL');

export function createPgPool(databaseUrl: string, max: number): Pool {
  const pool = new Pool({
    connectionString: databaseUrl,
    max,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
  });
  // Verliert ein Leerlauf-Client die Verbindung (Datenbank-Neustart, Failover), meldet pg das als „error“ des Pools.
  // Ohne Listener würde daraus eine unbehandelte Ausnahme und das Backend beendete sich. Der Pool verwirft den Client
  // selbst und baut bei Bedarf eine neue Verbindung auf.
  const logger = new Logger('Postgres');
  pool.on('error', (fehler) => logger.warn(`Leerlauf-Verbindung verloren: ${fehler.message}`));
  return pool;
}
