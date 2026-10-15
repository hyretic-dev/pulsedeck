import { Inject, Injectable } from '@nestjs/common';
import type { Pool } from 'pg';

import { schreibeAudit } from '../common/audit';
import { meldeAenderung } from '../common/changes';
import { inTransaction } from '../common/db';
import { nichtGefunden } from '../common/http-error';
import { PG_POOL } from '../infrastructure/postgres/pg.pool';

const SPALTEN = 'id, name, role, description, email, phone, location, image_url, organization_id, created_at, updated_at';
const FELDER = ['name', 'role', 'description', 'email', 'phone', 'location', 'image_url'] as const;
type Eingabe = Partial<Record<(typeof FELDER)[number], string | null>>;

@Injectable()
export class ContactsService {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  /** Kontakte der Organisation sowie globale Altkontakte (`organization_id IS NULL`, nur lesbar). */
  async liste(orgId: string): Promise<Record<string, unknown>[]> {
    const { rows } = await this.pool.query(`SELECT ${SPALTEN} FROM contacts WHERE organization_id = $1 OR organization_id IS NULL ORDER BY name ASC`, [orgId]);
    return rows;
  }

  async anlegen(userId: string, orgId: string, eingabe: Eingabe): Promise<Record<string, unknown>> {
    return inTransaction(this.pool, async (db) => {
      const felder = FELDER.filter((k) => eingabe[k] !== undefined);
      const { rows } = await db.query(
        `INSERT INTO contacts (organization_id, ${felder.join(', ')}) VALUES ($1, ${felder.map((_, i) => `$${i + 2}`).join(', ')}) RETURNING ${SPALTEN}`,
        [orgId, ...felder.map((k) => eingabe[k])]
      );
      await schreibeAudit(db, { table: 'contacts', operation: 'INSERT', recordId: rows[0].id, newData: rows[0], performedBy: userId, organizationId: orgId });
      await meldeAenderung(db, { table: 'contacts', organizationId: orgId, operation: 'INSERT', id: rows[0].id });
      return rows[0];
    });
  }

  async aendern(userId: string, orgId: string, id: string, eingabe: Eingabe): Promise<Record<string, unknown>> {
    return inTransaction(this.pool, async (db) => {
      const alt = await db.query(`SELECT ${SPALTEN} FROM contacts WHERE id = $1 AND organization_id = $2 FOR UPDATE`, [id, orgId]);
      if (!alt.rows[0]) throw nichtGefunden('Kontakt');
      const felder = FELDER.filter((k) => eingabe[k] !== undefined);
      if (felder.length === 0) return alt.rows[0];
      const { rows } = await db.query(
        `UPDATE contacts SET ${felder.map((k, i) => `${k} = $${i + 3}`).join(', ')}, updated_at = now() WHERE id = $1 AND organization_id = $2 RETURNING ${SPALTEN}`,
        [id, orgId, ...felder.map((k) => eingabe[k])]
      );
      await schreibeAudit(db, { table: 'contacts', operation: 'UPDATE', recordId: id, oldData: alt.rows[0], newData: rows[0], performedBy: userId, organizationId: orgId });
      await meldeAenderung(db, { table: 'contacts', organizationId: orgId, operation: 'UPDATE', id });
      return rows[0];
    });
  }

  async loeschen(userId: string, orgId: string, id: string): Promise<void> {
    await inTransaction(this.pool, async (db) => {
      const alt = await db.query(`SELECT ${SPALTEN} FROM contacts WHERE id = $1 AND organization_id = $2 FOR UPDATE`, [id, orgId]);
      if (!alt.rows[0]) throw nichtGefunden('Kontakt');
      await db.query('DELETE FROM contacts WHERE id = $1', [id]);
      await schreibeAudit(db, { table: 'contacts', operation: 'DELETE', recordId: id, oldData: alt.rows[0], performedBy: userId, organizationId: orgId });
      await meldeAenderung(db, { table: 'contacts', organizationId: orgId, operation: 'DELETE', id });
    });
  }
}
