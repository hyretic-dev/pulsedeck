import { Inject, Injectable } from '@nestjs/common';
import type { Pool } from 'pg';

import { schreibeAudit } from '../common/audit';
import { PG_FEHLER, inTransaction, istPgFehler } from '../common/db';
import { konflikt, nichtGefunden, ungueltig, verboten } from '../common/http-error';
import { PG_POOL } from '../infrastructure/postgres/pg.pool';
import type { Membership } from '../tenancy/membership';
import { isAdmin } from '../tenancy/permissions';

const SKILL_SPALTEN = 'id, organization_id, name, category, icon, description, sort_order, created_at, updated_at';

@Injectable()
export class SkillsService {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  async liste(orgId: string): Promise<Record<string, unknown>[]> {
    const { rows } = await this.pool.query(
      `SELECT ${SKILL_SPALTEN} FROM skills WHERE organization_id = $1 ORDER BY category, sort_order, name`,
      [orgId]
    );
    return rows;
  }

  async anlegen(userId: string, orgId: string, eingabe: { name: string; category?: string; icon?: string | null; description?: string | null; sort_order?: number }): Promise<Record<string, unknown>> {
    try {
      return await inTransaction(this.pool, async (db) => {
        const { rows } = await db.query(
          `INSERT INTO skills (organization_id, name, category, icon, description, sort_order)
           VALUES ($1, $2, COALESCE($3, 'ability'), $4, $5, COALESCE($6, 0)) RETURNING ${SKILL_SPALTEN}`,
          [orgId, eingabe.name.trim(), eingabe.category ?? null, eingabe.icon ?? null, eingabe.description ?? null, eingabe.sort_order ?? null]
        );
        await schreibeAudit(db, { table: 'skills', operation: 'INSERT', recordId: rows[0].id, newData: rows[0], performedBy: userId, organizationId: orgId });
        return rows[0];
      });
    } catch (fehler) {
      if (istPgFehler(fehler, PG_FEHLER.EINDEUTIG)) throw konflikt('skill_name_taken', 'Diese Fähigkeit existiert bereits');
      throw fehler;
    }
  }

  async aendern(userId: string, orgId: string, skillId: string, eingabe: Record<string, unknown>): Promise<Record<string, unknown>> {
    const felder = ['name', 'category', 'icon', 'description', 'sort_order'].filter((k) => eingabe[k] !== undefined);
    try {
      return await inTransaction(this.pool, async (db) => {
        const alt = await db.query(`SELECT ${SKILL_SPALTEN} FROM skills WHERE id = $1 AND organization_id = $2 FOR UPDATE`, [skillId, orgId]);
        if (!alt.rows[0]) throw nichtGefunden('Fähigkeit');
        if (felder.length === 0) return alt.rows[0];
        const { rows } = await db.query(
          `UPDATE skills SET ${felder.map((k, i) => `${k} = $${i + 3}`).join(', ')}, updated_at = now()
            WHERE id = $1 AND organization_id = $2 RETURNING ${SKILL_SPALTEN}`,
          [skillId, orgId, ...felder.map((k) => eingabe[k])]
        );
        await schreibeAudit(db, { table: 'skills', operation: 'UPDATE', recordId: skillId, oldData: alt.rows[0], newData: rows[0], performedBy: userId, organizationId: orgId });
        return rows[0];
      });
    } catch (fehler) {
      if (istPgFehler(fehler, PG_FEHLER.EINDEUTIG)) throw konflikt('skill_name_taken', 'Diese Fähigkeit existiert bereits');
      throw fehler;
    }
  }

  async loeschen(userId: string, orgId: string, skillId: string): Promise<void> {
    await inTransaction(this.pool, async (db) => {
      const { rows } = await db.query(`DELETE FROM skills WHERE id = $1 AND organization_id = $2 RETURNING ${SKILL_SPALTEN}`, [skillId, orgId]);
      if (!rows[0]) throw nichtGefunden('Fähigkeit');
      await schreibeAudit(db, { table: 'skills', operation: 'DELETE', recordId: skillId, oldData: rows[0], performedBy: userId, organizationId: orgId });
    });
  }

  /** Alle Zuordnungen der Organisation: member_id → skill_ids (Ersatz für getAllMemberSkills). */
  async alleZuordnungen(orgId: string): Promise<Record<string, string[]>> {
    const { rows } = await this.pool.query<{ member_id: string; skill_id: string }>(
      `SELECT ms.member_id, ms.skill_id FROM member_skills ms JOIN members m ON m.id = ms.member_id WHERE m.organization_id = $1`,
      [orgId]
    );
    const karte: Record<string, string[]> = {};
    for (const r of rows) (karte[r.member_id] ??= []).push(r.skill_id);
    return karte;
  }

  private async pruefeMitglied(orgId: string, memberId: string): Promise<void> {
    const { rowCount } = await this.pool.query('SELECT 1 FROM members WHERE id = $1 AND organization_id = $2', [memberId, orgId]);
    if (!rowCount) throw nichtGefunden('Mitglied');
  }

  /** Eigene Skills darf jedes Mitglied pflegen, fremde nur ein Administrator. */
  private pruefeSchreibrecht(aufrufer: Membership, memberId: string): void {
    if (aufrufer.member.id !== memberId && !isAdmin(aufrufer)) throw verboten();
  }

  async skillIdsVon(orgId: string, memberId: string): Promise<string[]> {
    await this.pruefeMitglied(orgId, memberId);
    const { rows } = await this.pool.query<{ skill_id: string }>('SELECT skill_id FROM member_skills WHERE member_id = $1', [memberId]);
    return rows.map((r) => r.skill_id);
  }

  /** Ersetzt die Skills eines Mitglieds atomar (der Bestand löschte und fügte getrennt ein). */
  async setzeSkills(orgId: string, aufrufer: Membership, memberId: string, skillIds: string[]): Promise<string[]> {
    this.pruefeSchreibrecht(aufrufer, memberId);
    await this.pruefeMitglied(orgId, memberId);
    const eindeutig = [...new Set(skillIds)];
    return inTransaction(this.pool, async (db) => {
      if (eindeutig.length > 0) {
        const gueltig = await db.query('SELECT count(*)::int AS n FROM skills WHERE organization_id = $1 AND id = ANY($2::uuid[])', [orgId, eindeutig]);
        if (gueltig.rows[0].n !== eindeutig.length) throw ungueltig('Mindestens eine Fähigkeit gehört nicht zu dieser Organisation');
      }
      await db.query('DELETE FROM member_skills WHERE member_id = $1', [memberId]);
      if (eindeutig.length > 0) {
        await db.query('INSERT INTO member_skills (member_id, skill_id) SELECT $1, unnest($2::uuid[])', [memberId, eindeutig]);
      }
      return eindeutig;
    });
  }

  async fuegeHinzu(orgId: string, aufrufer: Membership, memberId: string, skillId: string): Promise<void> {
    this.pruefeSchreibrecht(aufrufer, memberId);
    await this.pruefeMitglied(orgId, memberId);
    const { rowCount } = await this.pool.query(
      `INSERT INTO member_skills (member_id, skill_id)
       SELECT $1, s.id FROM skills s WHERE s.id = $2 AND s.organization_id = $3
       ON CONFLICT DO NOTHING`,
      [memberId, skillId, orgId]
    );
    if (!rowCount) {
      const vorhanden = await this.pool.query('SELECT 1 FROM skills WHERE id = $1 AND organization_id = $2', [skillId, orgId]);
      if (!vorhanden.rowCount) throw nichtGefunden('Fähigkeit');
    }
  }

  async entferne(orgId: string, aufrufer: Membership, memberId: string, skillId: string): Promise<void> {
    this.pruefeSchreibrecht(aufrufer, memberId);
    await this.pruefeMitglied(orgId, memberId);
    await this.pool.query('DELETE FROM member_skills WHERE member_id = $1 AND skill_id = $2', [memberId, skillId]);
  }

  /** Mitglieder mit mindestens einer der Fähigkeiten, absteigend nach Treffern (Ersatz für get_members_by_skills). */
  async mitgliederMitSkills(orgId: string, skillIds: string[]): Promise<Array<{ member_id: string; member_name: string; member_email: string; matching_skills: number }>> {
    if (skillIds.length === 0) return [];
    const { rows } = await this.pool.query(
      `SELECT m.id AS member_id, m.name AS member_name, m.email::text AS member_email, count(ms.skill_id)::int AS matching_skills
         FROM members m
         JOIN member_skills ms ON ms.member_id = m.id
         JOIN skills s ON s.id = ms.skill_id AND s.organization_id = m.organization_id
        WHERE m.organization_id = $1 AND ms.skill_id = ANY($2::uuid[])
        GROUP BY m.id, m.name, m.email
        ORDER BY matching_skills DESC, m.name`,
      [orgId, skillIds]
    );
    return rows;
  }
}
