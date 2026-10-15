import type { Queryable } from './db';

export type AuditOperation = 'INSERT' | 'UPDATE' | 'DELETE';

export interface AuditEintrag {
  table: string;
  operation: AuditOperation;
  recordId: string | null;
  oldData?: unknown;
  newData?: unknown;
  /** Konto aus dem verifizierten Token (nie aus Client-Feldern). */
  performedBy: string | null;
  organizationId: string | null;
}

/**
 * Schreibt einen Audit-Eintrag in der Transaktion der Änderung. Ersetzt den Bestands-Trigger
 * `log_audit_event` (E5): jede Änderung erzeugt genau einen Eintrag, und zwar nur, wenn die
 * Änderung selbst committet wird.
 */
export async function schreibeAudit(db: Queryable, eintrag: AuditEintrag): Promise<void> {
  await db.query(
    `INSERT INTO audit_logs (table_name, operation, record_id, old_data, new_data, performed_by, organization_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [
      eintrag.table,
      eintrag.operation,
      eintrag.recordId,
      eintrag.oldData === undefined ? null : JSON.stringify(eintrag.oldData),
      eintrag.newData === undefined ? null : JSON.stringify(eintrag.newData),
      eintrag.performedBy,
      eintrag.organizationId,
    ]
  );
}
