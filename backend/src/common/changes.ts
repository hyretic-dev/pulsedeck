import type { Queryable } from './db';

/** Kanal, über den Datenänderungen an alle Backend-Instanzen und Realtime-Clients gehen. */
export const CHANGES_CHANNEL = 'table_changes';

export interface ChangeEvent {
  table: string;
  organizationId: string | null;
  operation: 'INSERT' | 'UPDATE' | 'DELETE';
  id: string | null;
}

/**
 * Meldet eine Änderung per `pg_notify` **innerhalb der Transaktion**: PostgreSQL stellt die
 * Benachrichtigung erst beim Commit zu, bei Rollback nie. So wird erst nach erfolgreichem Commit
 * veröffentlicht (Gesamtauftrag §9). Nutzlast bewusst klein: Tabelle, Organisation, ID, Operation,
 * keine Daten (Clients laden neu, wie bisher bei „Tabelle geändert“).
 */
export async function meldeAenderung(db: Queryable, ereignis: ChangeEvent): Promise<void> {
  await db.query('SELECT pg_notify($1, $2)', [CHANGES_CHANNEL, JSON.stringify(ereignis)]);
}
