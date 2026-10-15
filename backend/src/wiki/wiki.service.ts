import { Inject, Injectable } from '@nestjs/common';
import type { Pool, PoolClient } from 'pg';

import { schreibeAudit } from '../common/audit';
import { meldeAenderung } from '../common/changes';
import { inTransaction, istPgFehler, PG_FEHLER } from '../common/db';
import { konflikt, nichtGefunden, ungueltig, verboten } from '../common/http-error';
import { PG_POOL } from '../infrastructure/postgres/pg.pool';
import type { Membership } from '../tenancy/membership';
import { hasPermission, isAdmin } from '../tenancy/permissions';

type Db = Pick<Pool, 'query'> | Pick<PoolClient, 'query'>;

const DOC_SPALTEN = 'd.id, d.title, d.description, d.content, d.last_updated, d.author, d.status, d.created_at, d.updated_at, d.allowed_roles, d.organization_id, d.working_group_id, d.category';
const KAT_SPALTEN = 'c.id, c.organization_id, c.working_group_id, c.name, c.icon, c.sort_order, c.created_at, c.updated_at';
const DOC_FELDER = ['title', 'description', 'content', 'category', 'status', 'allowed_roles', 'working_group_id'] as const;

export interface DocEingabe {
  title?: string;
  description?: string;
  content?: string | null;
  category?: string | null;
  status?: string;
  allowed_roles?: string[];
  working_group_id?: string | null;
}
export interface KategorieEingabe {
  name?: string;
  icon?: string | null;
  sort_order?: number;
  working_group_id?: string | null;
}

/** Wirksame Rolle für `allowed_roles`: Administratoren zählen als `admin`, sonst die Rolle der Mitgliedschaft. */
function rolle(m: Membership): string {
  return isAdmin(m) ? 'admin' : m.member.app_role;
}
const istVorstand = (m: Membership): boolean => isAdmin(m) || m.member.app_role === 'committee';

@Injectable()
export class WikiService {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  private async leitungsGruppen(db: Db, memberId: string): Promise<string[]> {
    const { rows } = await db.query<{ working_group_id: string }>("SELECT working_group_id FROM ag_memberships WHERE member_id = $1 AND role IN ('admin', 'lead')", [memberId]);
    return rows.map((r) => r.working_group_id);
  }

  private async gruppen(db: Db, memberId: string): Promise<string[]> {
    const { rows } = await db.query<{ working_group_id: string }>(
      'SELECT working_group_id FROM ag_memberships WHERE member_id = $1 UNION SELECT working_group_id FROM working_group_members WHERE member_id = $1',
      [memberId]
    );
    return rows.map((r) => r.working_group_id);
  }

  /** Schreiben: Recht `wiki:edit` (Vorstand und Admin haben es) oder Leitung der Arbeitsgruppe des Dokuments. */
  private async darfSchreiben(db: Db, aufrufer: Membership, groupId: string | null): Promise<boolean> {
    if (hasPermission(aufrufer, 'wiki:edit')) return true;
    return !!groupId && (await this.leitungsGruppen(db, aufrufer.member.id)).includes(groupId);
  }

  private async darfLoeschen(db: Db, aufrufer: Membership, groupId: string | null): Promise<boolean> {
    if (istVorstand(aufrufer)) return true;
    return !!groupId && (await this.leitungsGruppen(db, aufrufer.member.id)).includes(groupId);
  }

  // ── Dokumente ───────────────────────────────────────────────────────────────

  /**
   * Sichtbar: alles für Inhaltsbearbeiter (`wiki:edit`) und die Dokumente der eigenen Leitungsgruppen;
   * für alle anderen veröffentlichte Dokumente, deren `allowed_roles` `public` oder die eigene Rolle enthalten.
   */
  private async sichtbarkeit(db: Db, aufrufer: Membership): Promise<{ bedingung: string; params: unknown[] }> {
    return {
      bedingung: `($2::boolean OR d.working_group_id = ANY($3::uuid[]) OR (d.status = 'Published' AND ('public' = ANY(d.allowed_roles) OR $4 = ANY(d.allowed_roles))))`,
      params: [hasPermission(aufrufer, 'wiki:edit'), await this.leitungsGruppen(db, aufrufer.member.id), rolle(aufrufer)],
    };
  }

  async dokumente(orgId: string, aufrufer: Membership): Promise<Record<string, unknown>[]> {
    const { bedingung, params } = await this.sichtbarkeit(this.pool, aufrufer);
    const { rows } = await this.pool.query(`SELECT ${DOC_SPALTEN} FROM wiki_docs d WHERE d.organization_id = $1 AND ${bedingung} ORDER BY d.last_updated DESC, d.created_at DESC`, [orgId, ...params]);
    return rows;
  }

  async dokument(orgId: string, aufrufer: Membership, id: string): Promise<Record<string, unknown>> {
    const { bedingung, params } = await this.sichtbarkeit(this.pool, aufrufer);
    const { rows } = await this.pool.query(`SELECT ${DOC_SPALTEN} FROM wiki_docs d WHERE d.id = $1 AND d.organization_id = $5 AND ${bedingung}`, [id, ...params, orgId]);
    if (!rows[0]) throw nichtGefunden('Dokument');
    return rows[0];
  }

  /** Ablehnung ohne Existenz zu verraten: Unsichtbare Dokumente gibt es für den Aufrufer nicht (404), sichtbare darf er nur nicht ändern (403). */
  private async verweigere(orgId: string, aufrufer: Membership, id: string): Promise<never> {
    await this.dokument(orgId, aufrufer, id);
    throw verboten();
  }

  private async pruefeVerweise(db: Db, orgId: string, eingabe: DocEingabe): Promise<void> {
    if (eingabe.working_group_id) {
      const { rowCount } = await db.query('SELECT 1 FROM working_groups WHERE id = $1 AND organization_id = $2', [eingabe.working_group_id, orgId]);
      if (!rowCount) throw ungueltig('Die Arbeitsgruppe gehört nicht zu dieser Organisation');
    }
    if (eingabe.category) {
      const { rowCount } = await db.query('SELECT 1 FROM wiki_categories WHERE id = $1 AND organization_id = $2', [eingabe.category, orgId]);
      if (!rowCount) throw ungueltig('Die Kategorie gehört nicht zu dieser Organisation');
    }
  }

  async anlegen(userId: string, orgId: string, aufrufer: Membership, eingabe: DocEingabe): Promise<Record<string, unknown>> {
    if (!(await this.darfSchreiben(this.pool, aufrufer, eingabe.working_group_id ?? null))) throw verboten();
    return inTransaction(this.pool, async (db) => {
      await this.pruefeVerweise(db, orgId, eingabe);
      const werte: Record<string, unknown> = Object.fromEntries(DOC_FELDER.filter((k) => eingabe[k] !== undefined).map((k) => [k, eingabe[k]]));
      werte.status ??= 'Draft';
      const spalten = Object.keys(werte);
      const { rows } = await db.query(
        `INSERT INTO wiki_docs (organization_id, author, last_updated, ${spalten.join(', ')})
         VALUES ($1, $2, to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD'), ${spalten.map((_, i) => `$${i + 3}`).join(', ')}) RETURNING id`,
        [orgId, aufrufer.member.name, ...spalten.map((s) => werte[s])]
      );
      const id = rows[0].id as string;
      const neu = (await db.query(`SELECT ${DOC_SPALTEN} FROM wiki_docs d WHERE d.id = $1`, [id])).rows[0];
      await schreibeAudit(db, { table: 'wiki_docs', operation: 'INSERT', recordId: id, newData: neu, performedBy: userId, organizationId: orgId });
      await meldeAenderung(db, { table: 'wiki_docs', organizationId: orgId, operation: 'INSERT', id });
      return neu;
    });
  }

  async aendern(userId: string, orgId: string, aufrufer: Membership, id: string, eingabe: DocEingabe): Promise<Record<string, unknown>> {
    const felder = DOC_FELDER.filter((k) => eingabe[k] !== undefined);
    return inTransaction(this.pool, async (db) => {
      const { rows: alt } = await db.query(`SELECT ${DOC_SPALTEN} FROM wiki_docs d WHERE d.id = $1 AND d.organization_id = $2 FOR UPDATE`, [id, orgId]);
      if (!alt[0]) throw nichtGefunden('Dokument');
      // Berechtigung für die bisherige UND die neue Arbeitsgruppe, sonst ließe sich ein Dokument aus fremder Zuständigkeit entführen
      if (!(await this.darfSchreiben(db, aufrufer, alt[0].working_group_id))) await this.verweigere(orgId, aufrufer, id);
      if (eingabe.working_group_id !== undefined && !(await this.darfSchreiben(db, aufrufer, eingabe.working_group_id))) throw verboten();
      await this.pruefeVerweise(db, orgId, eingabe);
      if (felder.length === 0) return alt[0];
      await db.query(
        `UPDATE wiki_docs SET ${felder.map((k, i) => `${k} = $${i + 3}`).join(', ')}, last_updated = to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD'), updated_at = now() WHERE id = $1 AND organization_id = $2`,
        [id, orgId, ...felder.map((k) => eingabe[k])]
      );
      const neu = (await db.query(`SELECT ${DOC_SPALTEN} FROM wiki_docs d WHERE d.id = $1`, [id])).rows[0];
      await schreibeAudit(db, { table: 'wiki_docs', operation: 'UPDATE', recordId: id, oldData: alt[0], newData: neu, performedBy: userId, organizationId: orgId });
      await meldeAenderung(db, { table: 'wiki_docs', organizationId: orgId, operation: 'UPDATE', id });
      return neu;
    });
  }

  async loeschen(userId: string, orgId: string, aufrufer: Membership, id: string): Promise<void> {
    await inTransaction(this.pool, async (db) => {
      const { rows } = await db.query(`SELECT ${DOC_SPALTEN} FROM wiki_docs d WHERE d.id = $1 AND d.organization_id = $2 FOR UPDATE`, [id, orgId]);
      if (!rows[0]) throw nichtGefunden('Dokument');
      if (!(await this.darfLoeschen(db, aufrufer, rows[0].working_group_id))) await this.verweigere(orgId, aufrufer, id);
      await db.query('DELETE FROM wiki_docs WHERE id = $1', [id]);
      await schreibeAudit(db, { table: 'wiki_docs', operation: 'DELETE', recordId: id, oldData: rows[0], performedBy: userId, organizationId: orgId });
      await meldeAenderung(db, { table: 'wiki_docs', organizationId: orgId, operation: 'DELETE', id });
    });
  }

  // ── Kategorien ──────────────────────────────────────────────────────────────

  /** Globale Kategorien für alle Mitglieder; Arbeitsgruppen-Kategorien für deren Mitglieder und den Vorstand. */
  async kategorien(orgId: string, aufrufer: Membership): Promise<Record<string, unknown>[]> {
    const { rows } = await this.pool.query(
      `SELECT ${KAT_SPALTEN} FROM wiki_categories c
        WHERE c.organization_id = $1 AND (c.working_group_id IS NULL OR $2::boolean OR c.working_group_id = ANY($3::uuid[]))
        ORDER BY c.sort_order ASC, c.name ASC`,
      [orgId, istVorstand(aufrufer), await this.gruppen(this.pool, aufrufer.member.id)]
    );
    return rows;
  }

  /** Global: Vorstand/Admin. In einer Arbeitsgruppe: deren Leitung (und Administratoren). */
  private async darfKategorienVerwalten(db: Db, aufrufer: Membership, groupId: string | null): Promise<boolean> {
    if (!groupId) return istVorstand(aufrufer);
    return isAdmin(aufrufer) || (await this.leitungsGruppen(db, aufrufer.member.id)).includes(groupId);
  }

  async kategorieAnlegen(userId: string, orgId: string, aufrufer: Membership, eingabe: KategorieEingabe & { name: string }): Promise<Record<string, unknown>> {
    const groupId = eingabe.working_group_id ?? null;
    if (!(await this.darfKategorienVerwalten(this.pool, aufrufer, groupId))) throw verboten();
    return inTransaction(this.pool, async (db) => {
      if (groupId) {
        const { rowCount } = await db.query('SELECT 1 FROM working_groups WHERE id = $1 AND organization_id = $2', [groupId, orgId]);
        if (!rowCount) throw ungueltig('Die Arbeitsgruppe gehört nicht zu dieser Organisation');
      }
      try {
        const { rows } = await db.query(
          `INSERT INTO wiki_categories (organization_id, working_group_id, name, icon, sort_order) VALUES ($1, $2, $3, $4, $5) RETURNING id`,
          [orgId, groupId, eingabe.name, eingabe.icon ?? null, eingabe.sort_order ?? 0]
        );
        const neu = (await db.query(`SELECT ${KAT_SPALTEN} FROM wiki_categories c WHERE c.id = $1`, [rows[0].id])).rows[0];
        await schreibeAudit(db, { table: 'wiki_categories', operation: 'INSERT', recordId: rows[0].id, newData: neu, performedBy: userId, organizationId: orgId });
        await meldeAenderung(db, { table: 'wiki_categories', organizationId: orgId, operation: 'INSERT', id: rows[0].id });
        return neu;
      } catch (fehler) {
        if (istPgFehler(fehler, PG_FEHLER.EINDEUTIG)) throw konflikt('category_exists', 'Eine Kategorie mit diesem Namen gibt es schon');
        throw fehler;
      }
    });
  }

  private async ladeKategorie(db: Db, orgId: string, id: string, sperren = false): Promise<Record<string, any>> {
    const { rows } = await db.query(`SELECT ${KAT_SPALTEN} FROM wiki_categories c WHERE c.id = $1 AND c.organization_id = $2 ${sperren ? 'FOR UPDATE' : ''}`, [id, orgId]);
    if (!rows[0]) throw nichtGefunden('Kategorie');
    return rows[0];
  }

  async kategorieAendern(userId: string, orgId: string, aufrufer: Membership, id: string, eingabe: KategorieEingabe): Promise<Record<string, unknown>> {
    return inTransaction(this.pool, async (db) => {
      const alt = await this.ladeKategorie(db, orgId, id, true);
      if (!(await this.darfKategorienVerwalten(db, aufrufer, alt.working_group_id))) throw verboten();
      const felder = (['name', 'icon', 'sort_order'] as const).filter((k) => eingabe[k] !== undefined);
      if (felder.length === 0) return alt;
      try {
        await db.query(
          `UPDATE wiki_categories SET ${felder.map((k, i) => `${k} = $${i + 3}`).join(', ')}, updated_at = now() WHERE id = $1 AND organization_id = $2`,
          [id, orgId, ...felder.map((k) => eingabe[k])]
        );
      } catch (fehler) {
        if (istPgFehler(fehler, PG_FEHLER.EINDEUTIG)) throw konflikt('category_exists', 'Eine Kategorie mit diesem Namen gibt es schon');
        throw fehler;
      }
      const neu = await this.ladeKategorie(db, orgId, id);
      await schreibeAudit(db, { table: 'wiki_categories', operation: 'UPDATE', recordId: id, oldData: alt, newData: neu, performedBy: userId, organizationId: orgId });
      await meldeAenderung(db, { table: 'wiki_categories', organizationId: orgId, operation: 'UPDATE', id });
      return neu;
    });
  }

  async kategorieLoeschen(userId: string, orgId: string, aufrufer: Membership, id: string): Promise<void> {
    await inTransaction(this.pool, async (db) => {
      const alt = await this.ladeKategorie(db, orgId, id, true);
      if (!(await this.darfKategorienVerwalten(db, aufrufer, alt.working_group_id))) throw verboten();
      await db.query('DELETE FROM wiki_categories WHERE id = $1', [id]); // Dokumente behalten ihren Inhalt, die Kategorie wird leer (FK SET NULL)
      await schreibeAudit(db, { table: 'wiki_categories', operation: 'DELETE', recordId: id, oldData: alt, performedBy: userId, organizationId: orgId });
      await meldeAenderung(db, { table: 'wiki_categories', organizationId: orgId, operation: 'DELETE', id });
    });
  }
}
