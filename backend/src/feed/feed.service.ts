import { Inject, Injectable } from '@nestjs/common';
import type { Pool } from 'pg';

import { schreibeAudit } from '../common/audit';
import { meldeAenderung } from '../common/changes';
import { inTransaction } from '../common/db';
import { konflikt, nichtGefunden, ungueltig, verboten } from '../common/http-error';
import { PG_POOL } from '../infrastructure/postgres/pg.pool';
import type { Membership } from '../tenancy/membership';
import { pushKurztext, reihePushEin } from '../push/push-queue';
import { hasPermission } from '../tenancy/permissions';

export interface FeedEingabe {
  title?: string;
  content?: string | null;
  url?: string | null;
  type?: string;
  status?: string;
  is_public?: boolean;
  working_group_id?: string | null;
  poll_config?: { multiple_choice: boolean; end_date?: string };
  options?: string[];
}
const FELDER = ['title', 'content', 'url', 'status', 'is_public', 'working_group_id', 'poll_config'] as const;

/**
 * Beitragsspalten samt Verknüpfungen in der Form des Bestands (`author`, `working_group`, `poll_options` mit
 * `poll_votes`, `feed_item_reads`). Stimmen anderer Mitglieder werden anonymisiert (`member_id` null), die
 * eigene bleibt erkennbar; Lesebestätigungen sehen nur Autor und Freigeber vollständig.
 *   $2 = Mitglieds-ID des Aufrufers, $3 = darf freigeben (boolean)
 */
const FEED_SELECT = `
  SELECT f.id, f.created_at, f.updated_at, f.title, f.content, f.url, f.type, f.status, f.author_id, f.sent_at, f.organization_id,
         f.poll_config, f.is_public, f.working_group_id, f.is_pinned,
         jsonb_build_object('name', a.name) AS author,
         CASE WHEN g.id IS NULL THEN NULL ELSE jsonb_build_object('name', g.name, 'category', g.category) END AS working_group,
         COALESCE((SELECT jsonb_agg(jsonb_build_object('id', o.id, 'text', o.text, 'sort_order', o.sort_order,
                      'poll_votes', (SELECT COALESCE(jsonb_agg(jsonb_build_object('member_id', CASE WHEN v.member_id = $2 THEN v.member_id END)), '[]')
                                       FROM poll_votes v WHERE v.option_id = o.id)) ORDER BY o.sort_order, o.created_at)
                     FROM poll_options o WHERE o.feed_item_id = f.id), '[]') AS poll_options,
         COALESCE((SELECT jsonb_agg(jsonb_build_object('member_id', r.member_id)) FROM feed_item_reads r
                    WHERE r.feed_item_id = f.id AND ($3::boolean OR f.author_id = $2 OR r.member_id = $2)), '[]') AS feed_item_reads
    FROM feed_items f JOIN members a ON a.id = f.author_id LEFT JOIN working_groups g ON g.id = f.working_group_id`;

@Injectable()
export class FeedService {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  private darfFreigeben(aufrufer: Membership): boolean {
    return hasPermission(aufrufer, 'feed:approve');
  }

  private async liste(orgId: string, aufrufer: Membership, bedingung: string, params: unknown[], reihenfolge: string): Promise<Record<string, unknown>[]> {
    const { rows } = await this.pool.query(
      `${FEED_SELECT} WHERE f.organization_id = $1 AND ${bedingung} ORDER BY ${reihenfolge}`,
      [orgId, aufrufer.member.id, this.darfFreigeben(aufrufer), ...params]
    );
    return rows;
  }

  /** Veröffentlichte Beiträge (freigegeben oder versendet), angeheftete zuerst. */
  veroeffentlicht(orgId: string, aufrufer: Membership) {
    return this.liste(orgId, aufrufer, "f.status IN ('approved', 'sent')", [], 'f.is_pinned DESC, f.created_at DESC');
  }

  eigene(orgId: string, aufrufer: Membership) {
    return this.liste(orgId, aufrufer, 'f.author_id = $2', [], 'f.created_at DESC');
  }

  private nurFreigeber(aufrufer: Membership): void {
    if (!this.darfFreigeben(aufrufer)) throw verboten();
  }

  zurPruefung(orgId: string, aufrufer: Membership) {
    this.nurFreigeber(aufrufer);
    return this.liste(orgId, aufrufer, "f.status = 'review'", [], 'f.created_at DESC');
  }

  newsletterWarteschlange(orgId: string, aufrufer: Membership) {
    this.nurFreigeber(aufrufer);
    return this.liste(orgId, aufrufer, "f.status = 'approved'", [], 'f.created_at DESC');
  }

  versendet(orgId: string, aufrufer: Membership) {
    this.nurFreigeber(aufrufer);
    return this.liste(orgId, aufrufer, "f.status = 'sent'", [], 'f.sent_at DESC NULLS LAST');
  }

  private async pruefeGruppe(db: Pick<Pool, 'query'>, orgId: string, groupId: string | null | undefined): Promise<void> {
    if (!groupId) return;
    const { rowCount } = await db.query('SELECT 1 FROM working_groups WHERE id = $1 AND organization_id = $2', [groupId, orgId]);
    if (!rowCount) throw ungueltig('Die Arbeitsgruppe gehört nicht zu dieser Organisation');
  }

  private pruefeStatus(aufrufer: Membership, status: string | undefined): void {
    if (status === 'approved' && !this.darfFreigeben(aufrufer)) throw verboten('Beiträge freigeben darf nur, wer das Recht dazu hat');
  }

  async anlegen(userId: string, orgId: string, aufrufer: Membership, eingabe: FeedEingabe): Promise<Record<string, unknown>> {
    this.pruefeStatus(aufrufer, eingabe.status);
    if (eingabe.type === 'poll' && (eingabe.options?.length ?? 0) < 2) throw ungueltig('Eine Umfrage braucht mindestens zwei Antwortmöglichkeiten');
    if (eingabe.type !== 'poll' && (eingabe.options?.length || eingabe.poll_config)) throw ungueltig('Optionen und Abstimmungs-Einstellungen gibt es nur bei Umfragen');
    if (eingabe.type === 'link' && !eingabe.url) throw ungueltig('Ein Link-Beitrag braucht eine Adresse');
    return inTransaction(this.pool, async (db) => {
      await this.pruefeGruppe(db, orgId, eingabe.working_group_id);
      const werte: Record<string, unknown> = { type: eingabe.type, status: eingabe.status ?? 'draft' };
      for (const feld of FELDER) if (feld !== 'status' && eingabe[feld] !== undefined) werte[feld] = feld === 'poll_config' ? JSON.stringify(eingabe[feld]) : eingabe[feld];
      const spalten = Object.keys(werte);
      const { rows } = await db.query(
        `INSERT INTO feed_items (organization_id, author_id, ${spalten.join(', ')}) VALUES ($1, $2, ${spalten.map((_, i) => `$${i + 3}`).join(', ')}) RETURNING id`,
        [orgId, aufrufer.member.id, ...spalten.map((s) => werte[s])]
      );
      const id = rows[0].id as string;
      for (const [index, text] of (eingabe.options ?? []).entries()) {
        await db.query('INSERT INTO poll_options (feed_item_id, text, sort_order) VALUES ($1, $2, $3)', [id, text, index]);
      }
      const angelegt = await this.einzeln(db, orgId, aufrufer, id);
      await schreibeAudit(db, { table: 'feed_items', operation: 'INSERT', recordId: id, newData: angelegt, performedBy: userId, organizationId: orgId });
      await meldeAenderung(db, { table: 'feed_items', organizationId: orgId, operation: 'INSERT', id });
      if (angelegt.status === 'approved') await this.benachrichtige(db, orgId, angelegt);
      return angelegt;
    });
  }

  private async einzeln(db: Pick<Pool, 'query'>, orgId: string, aufrufer: Membership, id: string): Promise<Record<string, unknown>> {
    const { rows } = await db.query(`${FEED_SELECT} WHERE f.id = $1 AND f.organization_id = $4`, [id, aufrufer.member.id, this.darfFreigeben(aufrufer), orgId]);
    if (!rows[0]) throw nichtGefunden('Beitrag');
    return rows[0];
  }

  /** Sichtbarkeit: Freigeber alles, sonst eigene Beiträge und veröffentlichte (andere Entwürfe gibt es nicht). */
  private async ladeSichtbar(db: Pick<Pool, 'query'>, orgId: string, aufrufer: Membership, id: string, sperren = false): Promise<{ id: string; status: string; author_id: string; type: string; poll_config: { multiple_choice?: boolean; end_date?: string } | null }> {
    const { rows } = await db.query(
      `SELECT id, status, author_id, type, poll_config FROM feed_items WHERE id = $1 AND organization_id = $2 ${sperren ? 'FOR UPDATE' : ''}`,
      [id, orgId]
    );
    const item = rows[0];
    if (!item || !(this.darfFreigeben(aufrufer) || item.author_id === aufrufer.member.id || ['approved', 'sent'].includes(item.status))) throw nichtGefunden('Beitrag');
    return item;
  }

  async aendern(userId: string, orgId: string, aufrufer: Membership, id: string, eingabe: FeedEingabe): Promise<Record<string, unknown>> {
    return inTransaction(this.pool, async (db) => {
      const alt = await this.ladeSichtbar(db, orgId, aufrufer, id, true);
      const freigeber = this.darfFreigeben(aufrufer);
      if (alt.status === 'sent') throw konflikt('item_sent', 'Versendete Beiträge können nicht mehr geändert werden');
      if (!freigeber) {
        // Autoren bearbeiten nur eigene Entwürfe und Beiträge in Prüfung; Freigabe bleibt den Freigebern vorbehalten.
        if (alt.author_id !== aufrufer.member.id || !['draft', 'review'].includes(alt.status)) throw verboten();
        this.pruefeStatus(aufrufer, eingabe.status);
      }
      if (eingabe.poll_config && alt.type !== 'poll') throw ungueltig('Abstimmungs-Einstellungen gibt es nur bei Umfragen');
      await this.pruefeGruppe(db, orgId, eingabe.working_group_id);
      const felder = FELDER.filter((k) => eingabe[k] !== undefined);
      if (felder.length === 0) return this.einzeln(db, orgId, aufrufer, id);
      const vorher = await this.einzeln(db, orgId, aufrufer, id);
      await db.query(
        `UPDATE feed_items SET ${felder.map((k, i) => `${k} = $${i + 3}`).join(', ')}, updated_at = now() WHERE id = $1 AND organization_id = $2`,
        [id, orgId, ...felder.map((k) => (k === 'poll_config' ? JSON.stringify(eingabe[k]) : eingabe[k]))]
      );
      const neu = await this.einzeln(db, orgId, aufrufer, id);
      await schreibeAudit(db, { table: 'feed_items', operation: 'UPDATE', recordId: id, oldData: vorher, newData: neu, performedBy: userId, organizationId: orgId });
      await meldeAenderung(db, { table: 'feed_items', organizationId: orgId, operation: 'UPDATE', id });
      if (neu.status === 'approved' && vorher.status !== 'approved') await this.benachrichtige(db, orgId, neu);
      return neu;
    });
  }

  /** Push beim Veröffentlichen eines Beitrags (einmal beim Übergang nach „freigegeben“, nicht bei jeder späteren Änderung). */
  private async benachrichtige(db: Pick<Pool, 'query'>, orgId: string, item: Record<string, unknown>): Promise<void> {
    await reihePushEin(db, { organizationId: orgId, kind: 'feed', refId: String(item.id), title: String(item.title), message: pushKurztext(item.content as string | null), url: '/dashboard/feed' });
  }

  async loeschen(userId: string, orgId: string, aufrufer: Membership, id: string): Promise<void> {
    await inTransaction(this.pool, async (db) => {
      const item = await this.ladeSichtbar(db, orgId, aufrufer, id, true);
      if (!this.darfFreigeben(aufrufer) && item.author_id !== aufrufer.member.id) throw verboten();
      const vorher = await this.einzeln(db, orgId, aufrufer, id);
      await db.query('DELETE FROM feed_items WHERE id = $1', [id]);
      await schreibeAudit(db, { table: 'feed_items', operation: 'DELETE', recordId: id, oldData: vorher, performedBy: userId, organizationId: orgId });
      await meldeAenderung(db, { table: 'feed_items', organizationId: orgId, operation: 'DELETE', id });
    });
  }

  async anheften(userId: string, orgId: string, aufrufer: Membership, id: string, angeheftet: boolean): Promise<{ id: string; is_pinned: boolean }> {
    this.nurFreigeber(aufrufer);
    return inTransaction(this.pool, async (db) => {
      const item = await this.ladeSichtbar(db, orgId, aufrufer, id, true);
      if (!['approved', 'sent'].includes(item.status)) throw konflikt('item_not_published', 'Nur veröffentlichte Beiträge lassen sich anheften');
      await db.query('UPDATE feed_items SET is_pinned = $2, updated_at = now() WHERE id = $1', [id, angeheftet]);
      await schreibeAudit(db, { table: 'feed_items', operation: 'UPDATE', recordId: id, oldData: { is_pinned: !angeheftet }, newData: { is_pinned: angeheftet }, performedBy: userId, organizationId: orgId });
      await meldeAenderung(db, { table: 'feed_items', organizationId: orgId, operation: 'UPDATE', id });
      return { id, is_pinned: angeheftet };
    });
  }

  async alsGelesen(orgId: string, aufrufer: Membership, id: string): Promise<void> {
    await this.ladeSichtbar(this.pool, orgId, aufrufer, id);
    await this.pool.query('INSERT INTO feed_item_reads (feed_item_id, member_id) VALUES ($1, $2) ON CONFLICT (feed_item_id, member_id) DO NOTHING', [id, aufrufer.member.id]);
  }

  // ── Umfragen ────────────────────────────────────────────────────────────────

  private async ladeOption(db: Pick<Pool, 'query'>, orgId: string, optionId: string): Promise<{ feed_item_id: string }> {
    const { rows } = await db.query(
      `SELECT o.feed_item_id FROM poll_options o JOIN feed_items f ON f.id = o.feed_item_id WHERE o.id = $1 AND f.organization_id = $2`,
      [optionId, orgId]
    );
    if (!rows[0]) throw nichtGefunden('Antwortmöglichkeit');
    return rows[0];
  }

  /** Stimme abgeben; bei Einzelauswahl ersetzt sie die bisherige Stimme derselben Umfrage (atomar unter Sperre des Beitrags). */
  async abstimmen(orgId: string, aufrufer: Membership, optionId: string): Promise<void> {
    const { feed_item_id: itemId } = await this.ladeOption(this.pool, orgId, optionId);
    await inTransaction(this.pool, async (db) => {
      const item = await this.ladeSichtbar(db, orgId, aufrufer, itemId, true);
      if (!['approved', 'sent'].includes(item.status)) throw nichtGefunden('Beitrag');
      const ende = item.poll_config?.end_date;
      if (ende && new Date(ende).getTime() < Date.now()) throw konflikt('poll_closed', 'Die Abstimmung ist beendet');
      if (!item.poll_config?.multiple_choice) {
        await db.query(
          'DELETE FROM poll_votes WHERE member_id = $2 AND option_id IN (SELECT id FROM poll_options WHERE feed_item_id = $1 AND id <> $3)',
          [itemId, aufrufer.member.id, optionId]
        );
      }
      await db.query('INSERT INTO poll_votes (option_id, member_id) VALUES ($1, $2) ON CONFLICT (option_id, member_id) DO NOTHING', [optionId, aufrufer.member.id]);
      await meldeAenderung(db, { table: 'poll_votes', organizationId: orgId, operation: 'INSERT', id: itemId });
    });
  }

  async stimmeZurueckziehen(orgId: string, aufrufer: Membership, optionId: string): Promise<void> {
    const { feed_item_id: itemId } = await this.ladeOption(this.pool, orgId, optionId);
    await inTransaction(this.pool, async (db) => {
      const item = await this.ladeSichtbar(db, orgId, aufrufer, itemId, true);
      const ende = item.poll_config?.end_date;
      if (ende && new Date(ende).getTime() < Date.now()) throw konflikt('poll_closed', 'Die Abstimmung ist beendet');
      await db.query('DELETE FROM poll_votes WHERE option_id = $1 AND member_id = $2', [optionId, aufrufer.member.id]);
      await meldeAenderung(db, { table: 'poll_votes', organizationId: orgId, operation: 'DELETE', id: itemId });
    });
  }
}
