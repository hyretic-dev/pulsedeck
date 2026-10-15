import { Inject, Injectable } from '@nestjs/common';
import type { Pool, PoolClient } from 'pg';

import { schreibeAudit } from '../common/audit';
import { meldeAenderung } from '../common/changes';
import { inTransaction } from '../common/db';
import { nichtGefunden, verboten } from '../common/http-error';
import { PG_POOL } from '../infrastructure/postgres/pg.pool';
import type { Membership } from '../tenancy/membership';
import { isAdmin } from '../tenancy/permissions';

const AG_SPALTEN = `g.id, g.name, g.description, g.lead, g.next_meeting, g.contact_type, g.contact_value, g.contact_link,
  g.contact_icon, COALESCE(g.tags, '{}') AS tags, g.category, g.organization_id, g.created_at, g.updated_at`;

/** Mitglieder einer AG: `ag_memberships` (mit Rolle) und der ältere Bestand `working_group_members` (ohne Rolle). */
const MITGLIEDER_VEREINIGT = `
  SELECT id, member_id, working_group_id, role, joined_at FROM ag_memberships
  UNION ALL
  SELECT l.id, l.member_id, l.working_group_id, 'member', l.joined_at FROM working_group_members l
   WHERE NOT EXISTS (SELECT 1 FROM ag_memberships a WHERE a.working_group_id = l.working_group_id AND a.member_id = l.member_id)`;

export interface AgEingabe {
  name?: string;
  description?: string;
  lead?: string;
  next_meeting?: string;
  contact_type?: string;
  contact_value?: string | null;
  contact_link?: string | null;
  contact_icon?: string;
  tags?: string[];
  category?: string | null;
}

const FELDER = ['name', 'description', 'lead', 'next_meeting', 'contact_type', 'contact_value', 'contact_link', 'contact_icon', 'tags', 'category'] as const;

@Injectable()
export class WorkingGroupsService {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  private async istAgLeitung(db: Pick<Pool, 'query'> | Pick<PoolClient, 'query'>, groupId: string, memberId: string): Promise<boolean> {
    const { rowCount } = await db.query(
      "SELECT 1 FROM ag_memberships WHERE working_group_id = $1 AND member_id = $2 AND role IN ('admin', 'lead')",
      [groupId, memberId]
    );
    return (rowCount ?? 0) > 0;
  }

  /** Verwalten dürfen Organisations-Administratoren sowie Admin/Leitung der jeweiligen AG. */
  private async pruefeVerwaltung(aufrufer: Membership, groupId: string): Promise<void> {
    if (isAdmin(aufrufer)) return;
    if (!(await this.istAgLeitung(this.pool, groupId, aufrufer.member.id))) throw verboten();
  }

  private async lade(db: Pick<Pool, 'query'> | Pick<PoolClient, 'query'>, orgId: string, groupId: string): Promise<Record<string, unknown>> {
    const { rows } = await db.query(`SELECT ${AG_SPALTEN} FROM working_groups g WHERE g.id = $1 AND g.organization_id = $2`, [groupId, orgId]);
    if (!rows[0]) throw nichtGefunden('Arbeitsgruppe');
    return rows[0];
  }

  /**
   * Liste mit Mitgliederzahl (beide Mitgliedschaftstabellen vereinigt) und, für Administratoren, Vorstand und
   * AG-Leitung, der Zahl der Mitglieder ohne den von der AG verlangten Kontaktkanal (im Bestand N+1-Abfragen im Browser).
   */
  async liste(orgId: string, aufrufer: Membership): Promise<Record<string, unknown>[]> {
    const { rows } = await this.pool.query(
      `SELECT ${AG_SPALTEN},
              (SELECT count(DISTINCT x.member_id) FROM (${MITGLIEDER_VEREINIGT}) x WHERE x.working_group_id = g.id)::int AS members_count,
              (SELECT count(DISTINCT x.member_id) FROM (${MITGLIEDER_VEREINIGT}) x JOIN members m ON m.id = x.member_id
                WHERE x.working_group_id = g.id AND (
                  CASE WHEN g.contact_type = 'Email'
                       THEN COALESCE(m.email::text, '') = '' AND COALESCE(m.contact_channels->>'Email', '') = ''
                       ELSE COALESCE(m.contact_channels->>g.contact_type, '') = '' END))::int AS missing_contact_count,
              EXISTS (SELECT 1 FROM ag_memberships a WHERE a.working_group_id = g.id AND a.member_id = $2 AND a.role IN ('admin', 'lead')) AS ist_leitung
         FROM working_groups g WHERE g.organization_id = $1 ORDER BY g.name ASC`,
      [orgId, aufrufer.member.id]
    );
    const alleSehen = isAdmin(aufrufer) || aufrufer.member.app_role === 'committee';
    return rows.map(({ ist_leitung, missing_contact_count, ...gruppe }) => ({
      ...gruppe,
      ...(alleSehen || ist_leitung ? { missing_contact_count } : {}),
    }));
  }

  async kategorien(orgId: string): Promise<string[]> {
    const { rows } = await this.pool.query<{ category: string }>(
      'SELECT DISTINCT category FROM working_groups WHERE organization_id = $1 AND category IS NOT NULL AND category <> \'\' ORDER BY category',
      [orgId]
    );
    return rows.map((r) => r.category);
  }

  /** Eigene AG-Mitgliedschaften (Ersatz für fetchMyMemberships / fetchAgRoles). */
  async meine(orgId: string, aufrufer: Membership): Promise<Array<{ working_group_id: string; role: string }>> {
    const { rows } = await this.pool.query(
      `SELECT x.working_group_id, x.role FROM (${MITGLIEDER_VEREINIGT}) x
         JOIN working_groups g ON g.id = x.working_group_id
        WHERE x.member_id = $1 AND g.organization_id = $2`,
      [aufrufer.member.id, orgId]
    );
    return rows;
  }

  async anlegen(userId: string, orgId: string, eingabe: AgEingabe): Promise<Record<string, unknown>> {
    return inTransaction(this.pool, async (db) => {
      const felder = FELDER.filter((k) => eingabe[k] !== undefined);
      const { rows } = await db.query<{ id: string }>(
        `INSERT INTO working_groups (organization_id, ${felder.join(', ')})
         VALUES ($1, ${felder.map((_, i) => `$${i + 2}`).join(', ')}) RETURNING id`,
        [orgId, ...felder.map((k) => eingabe[k])]
      );
      const gruppe = await this.lade(db, orgId, rows[0].id);
      await schreibeAudit(db, { table: 'working_groups', operation: 'INSERT', recordId: rows[0].id, newData: gruppe, performedBy: userId, organizationId: orgId });
      await meldeAenderung(db, { table: 'working_groups', organizationId: orgId, operation: 'INSERT', id: rows[0].id });
      return { ...gruppe, members_count: 0 };
    });
  }

  async aendern(userId: string, orgId: string, aufrufer: Membership, groupId: string, eingabe: AgEingabe): Promise<Record<string, unknown>> {
    await this.lade(this.pool, orgId, groupId);
    await this.pruefeVerwaltung(aufrufer, groupId);
    const felder = FELDER.filter((k) => eingabe[k] !== undefined);
    return inTransaction(this.pool, async (db) => {
      const alt = await this.lade(db, orgId, groupId);
      if (felder.length === 0) return alt;
      await db.query(
        `UPDATE working_groups g SET ${felder.map((k, i) => `${k} = $${i + 3}`).join(', ')}, updated_at = now() WHERE g.id = $1 AND g.organization_id = $2`,
        [groupId, orgId, ...felder.map((k) => eingabe[k])]
      );
      const neu = await this.lade(db, orgId, groupId);
      await schreibeAudit(db, { table: 'working_groups', operation: 'UPDATE', recordId: groupId, oldData: alt, newData: neu, performedBy: userId, organizationId: orgId });
      await meldeAenderung(db, { table: 'working_groups', organizationId: orgId, operation: 'UPDATE', id: groupId });
      return neu;
    });
  }

  async loeschen(userId: string, orgId: string, groupId: string): Promise<void> {
    await inTransaction(this.pool, async (db) => {
      const alt = await this.lade(db, orgId, groupId);
      await db.query('DELETE FROM working_groups WHERE id = $1 AND organization_id = $2', [groupId, orgId]);
      await schreibeAudit(db, { table: 'working_groups', operation: 'DELETE', recordId: groupId, oldData: alt, performedBy: userId, organizationId: orgId });
      await meldeAenderung(db, { table: 'working_groups', organizationId: orgId, operation: 'DELETE', id: groupId });
    });
  }

  async mitglieder(orgId: string, groupId: string): Promise<Array<{ id: string; member_id: string; name: string; role: string }>> {
    await this.lade(this.pool, orgId, groupId);
    const { rows } = await this.pool.query(
      `SELECT x.id, x.member_id, COALESCE(m.name, 'Unbekannt') AS name, x.role
         FROM (${MITGLIEDER_VEREINIGT}) x JOIN members m ON m.id = x.member_id
        WHERE x.working_group_id = $1 AND m.organization_id = $2 ORDER BY m.name`,
      [groupId, orgId]
    );
    return rows;
  }

  /** Beitritt zur AG der eigenen Organisation; immer als `member` (im Bestand konnte man sich `lead` selbst zuweisen). */
  async beitreten(orgId: string, aufrufer: Membership, groupId: string): Promise<{ working_group_id: string; role: string }> {
    return this.hinzufuegenIntern(orgId, groupId, aufrufer.member.id, 'member', aufrufer.member.id);
  }

  async hinzufuegen(userId: string, orgId: string, aufrufer: Membership, groupId: string, memberId: string, role: string): Promise<{ working_group_id: string; role: string }> {
    await this.lade(this.pool, orgId, groupId);
    await this.pruefeVerwaltung(aufrufer, groupId);
    return this.hinzufuegenIntern(orgId, groupId, memberId, role, userId);
  }

  private async hinzufuegenIntern(orgId: string, groupId: string, memberId: string, role: string, userId: string): Promise<{ working_group_id: string; role: string }> {
    return inTransaction(this.pool, async (db) => {
      await this.lade(db, orgId, groupId);
      const mitglied = await db.query('SELECT 1 FROM members WHERE id = $1 AND organization_id = $2', [memberId, orgId]);
      if (!mitglied.rowCount) throw nichtGefunden('Mitglied');
      const { rows } = await db.query(
        `INSERT INTO ag_memberships (working_group_id, member_id, role) VALUES ($1, $2, $3)
         ON CONFLICT (working_group_id, member_id) DO UPDATE SET role = EXCLUDED.role WHERE ag_memberships.role <> EXCLUDED.role AND $4::boolean
         RETURNING id, role`,
        [groupId, memberId, role, role !== 'member']
      );
      const aktuell = rows[0] ?? (await db.query('SELECT id, role FROM ag_memberships WHERE working_group_id = $1 AND member_id = $2', [groupId, memberId])).rows[0];
      await schreibeAudit(db, { table: 'ag_memberships', operation: 'INSERT', recordId: aktuell.id, newData: { working_group_id: groupId, member_id: memberId, role: aktuell.role }, performedBy: userId, organizationId: orgId });
      await meldeAenderung(db, { table: 'ag_memberships', organizationId: orgId, operation: 'INSERT', id: aktuell.id });
      return { working_group_id: groupId, role: aktuell.role };
    });
  }

  async rolleAendern(userId: string, orgId: string, aufrufer: Membership, groupId: string, memberId: string, role: string): Promise<void> {
    await this.lade(this.pool, orgId, groupId);
    await this.pruefeVerwaltung(aufrufer, groupId);
    await inTransaction(this.pool, async (db) => {
      const alt = await db.query('SELECT id, role FROM ag_memberships WHERE working_group_id = $1 AND member_id = $2 FOR UPDATE', [groupId, memberId]);
      if (!alt.rows[0]) throw nichtGefunden('AG-Mitgliedschaft');
      await db.query('UPDATE ag_memberships SET role = $3 WHERE working_group_id = $1 AND member_id = $2', [groupId, memberId, role]);
      await schreibeAudit(db, { table: 'ag_memberships', operation: 'UPDATE', recordId: alt.rows[0].id, oldData: alt.rows[0], newData: { ...alt.rows[0], role }, performedBy: userId, organizationId: orgId });
      await meldeAenderung(db, { table: 'ag_memberships', organizationId: orgId, operation: 'UPDATE', id: alt.rows[0].id });
    });
  }

  /** Austreten (selbst) oder Entfernen (Administrator, AG-Leitung). */
  async entfernen(userId: string, orgId: string, aufrufer: Membership, groupId: string, memberId: string): Promise<void> {
    await this.lade(this.pool, orgId, groupId);
    if (memberId !== aufrufer.member.id) await this.pruefeVerwaltung(aufrufer, groupId);
    await inTransaction(this.pool, async (db) => {
      const weg = await db.query('DELETE FROM ag_memberships WHERE working_group_id = $1 AND member_id = $2 RETURNING id', [groupId, memberId]);
      await db.query('DELETE FROM working_group_members WHERE working_group_id = $1 AND member_id = $2', [groupId, memberId]);
      if (weg.rows[0]) {
        await schreibeAudit(db, { table: 'ag_memberships', operation: 'DELETE', recordId: weg.rows[0].id, oldData: { working_group_id: groupId, member_id: memberId }, performedBy: userId, organizationId: orgId });
      }
      await meldeAenderung(db, { table: 'ag_memberships', organizationId: orgId, operation: 'DELETE', id: weg.rows[0]?.id ?? null });
    });
  }
}
