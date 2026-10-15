import type { Pool, PoolClient } from 'pg';

/** Pool oder eine laufende Transaktion; Funktionen, die in beiden laufen dürfen, nehmen dies. */
export type Queryable = Pick<Pool, 'query'> | Pick<PoolClient, 'query'>;

/**
 * Führt `arbeit` in einer Transaktion aus: Commit bei Erfolg, Rollback bei jedem Fehler.
 * Zusammengesetzte Änderungen (Organisation anlegen, Anmeldung mit Kapazitätsprüfung, …) laufen
 * immer hier hinein, damit Nebenwirkungen genau einmal oder gar nicht entstehen (E5).
 */
export async function inTransaction<T>(
  pool: Pick<Pool, 'connect'>,
  arbeit: (client: PoolClient) => Promise<T>
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const ergebnis = await arbeit(client);
    await client.query('COMMIT');
    return ergebnis;
  } catch (fehler) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw fehler;
  } finally {
    client.release();
  }
}

/** PostgreSQL-Fehlercodes, auf die Services fachlich reagieren. */
export const PG_FEHLER = {
  EINDEUTIG: '23505',
  FREMDSCHLUESSEL: '23503',
  PRUEFUNG: '23514',
  NICHT_NULL: '23502',
} as const;

export function istPgFehler(fehler: unknown, code: string): boolean {
  return typeof fehler === 'object' && fehler !== null && (fehler as { code?: string }).code === code;
}
