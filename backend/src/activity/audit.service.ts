import { Inject, Injectable } from '@nestjs/common';
import type { Pool } from 'pg';

import { PG_POOL } from '../infrastructure/postgres/pg.pool';

/** Lesender Zugriff auf das Änderungsprotokoll (Schreiben passiert in den Fachdiensten, in der Transaktion der Änderung). */
@Injectable()
export class AuditService {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  async liste(filter: { orgId?: string; table?: string; limit?: number; offset?: number }): Promise<Record<string, unknown>[]> {
    const { rows } = await this.pool.query(
      `SELECT id, created_at, table_name, operation, record_id, old_data, new_data, performed_by, organization_id
         FROM audit_logs WHERE ($1::uuid IS NULL OR organization_id = $1) AND ($2::text IS NULL OR table_name = $2)
        ORDER BY created_at DESC, id DESC LIMIT $3 OFFSET $4`,
      [filter.orgId ?? null, filter.table ?? null, filter.limit ?? 100, filter.offset ?? 0]
    );
    return rows;
  }

  async organisationen(): Promise<Array<{ id: string; name: string }>> {
    const { rows } = await this.pool.query('SELECT id, name FROM organizations ORDER BY name');
    return rows;
  }
}
