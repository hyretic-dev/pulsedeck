import { Inject, Injectable } from '@nestjs/common';
import type { Pool } from 'pg';

import { meldeAenderung } from '../common/changes';
import { inTransaction } from '../common/db';
import { konflikt, nichtGefunden, ungueltig } from '../common/http-error';
import { PG_POOL } from '../infrastructure/postgres/pg.pool';
import { reiheMailsEin } from '../jobs/mail-outbox';
import { feedbackRueckmeldungMail } from '../mail/mail-templates';

const BOARD_SPALTEN = `f.id, f.created_at, f.type, f.description, f.user_id, f.status, f.organization_id, f.source, f.problem, f.topic,
  f.blocks_activation, f.decision, f.reply_text, f.replied_at`;

export interface BoardEingabe {
  type: 'bug' | 'suggestion';
  description: string;
  source?: 'gespraech' | 'mail';
  organization_id?: string;
  problem?: string;
  topic?: string;
  blocks_activation?: boolean;
}

export type BoardAenderung = Partial<{
  status: string;
  problem: string | null;
  topic: string | null;
  blocks_activation: boolean;
  decision: string | null;
}>;

/**
 * Feedback-Board für die Plattform: Einträge aus App, Gesprächen und Mails an einem Ort, mit dem eigentlichen Problem, einem Thema
 * (Zähler: wie viele Organisationen unabhängig voneinander), der Entscheidung und der persönlichen Rückmeldung.
 */
@Injectable()
export class FeedbackBoardService {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  private zeile(id: string): Promise<Record<string, unknown> | undefined> {
    return this.pool
      .query(`SELECT ${BOARD_SPALTEN} FROM feedback_submissions f WHERE f.id = $1`, [id])
      .then((r) => r.rows[0]);
  }

  async liste(grenzen: { orgId?: string; limit?: number; offset?: number }): Promise<Record<string, unknown>[]> {
    const { rows } = await this.pool.query(
      `SELECT ${BOARD_SPALTEN}, o.name AS organization_name,
              (SELECT m.name FROM members m WHERE m.user_id = f.user_id AND m.organization_id = f.organization_id LIMIT 1) AS reporter_name,
              (f.user_id IS NOT NULL) AS can_reply
         FROM feedback_submissions f LEFT JOIN organizations o ON o.id = f.organization_id
        WHERE ($1::uuid IS NULL OR f.organization_id = $1)
        ORDER BY f.created_at DESC, f.id DESC LIMIT $2 OFFSET $3`,
      [grenzen.orgId ?? null, grenzen.limit ?? 100, grenzen.offset ?? 0]
    );
    return rows;
  }

  /** Themen nach Zahl der betroffenen Organisationen: Grundlage der Bau-Regel („mindestens 3 Organisationen unabhängig voneinander“). */
  async themen(): Promise<Array<{ topic: string; organizations: number; entries: number; blocking: number; open: number }>> {
    const { rows } = await this.pool.query(
      `SELECT topic, count(DISTINCT organization_id)::int AS organizations, count(*)::int AS entries,
              (count(*) FILTER (WHERE blocks_activation))::int AS blocking,
              (count(*) FILTER (WHERE status NOT IN ('done', 'live')))::int AS open
         FROM feedback_submissions WHERE topic IS NOT NULL
        GROUP BY topic ORDER BY organizations DESC, entries DESC, topic`
    );
    return rows;
  }

  async anlegen(e: BoardEingabe): Promise<Record<string, unknown>> {
    const beschreibung = e.description.trim();
    if (!beschreibung) throw ungueltig('Beschreibung fehlt');
    if (e.organization_id) {
      const org = await this.pool.query('SELECT 1 FROM organizations WHERE id = $1', [e.organization_id]);
      if (org.rowCount === 0) throw nichtGefunden('Organisation');
    }
    const { rows } = await this.pool.query(
      `INSERT INTO feedback_submissions (type, description, organization_id, source, problem, topic, blocks_activation, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'new') RETURNING id`,
      [e.type, beschreibung, e.organization_id ?? null, e.source ?? 'gespraech', e.problem?.trim() || null, e.topic ?? null, e.blocks_activation ?? false]
    );
    if (e.organization_id) await meldeAenderung(this.pool, { table: 'feedback_submissions', organizationId: e.organization_id, operation: 'INSERT', id: rows[0].id });
    return (await this.zeile(rows[0].id)) as Record<string, unknown>;
  }

  async aendern(id: string, a: BoardAenderung): Promise<Record<string, unknown>> {
    const felder = (Object.keys(a) as Array<keyof BoardAenderung>).filter((k) => a[k] !== undefined);
    const werte = felder.map((k) => (k === 'problem' && typeof a[k] === 'string' ? (a[k] as string).trim() || null : a[k]));
    const { rows } = felder.length
      ? await this.pool.query(
          `UPDATE feedback_submissions SET ${felder.map((k, i) => `${k} = $${i + 2}`).join(', ')} WHERE id = $1 RETURNING id, organization_id`,
          [id, ...werte]
        )
      : await this.pool.query('SELECT id, organization_id FROM feedback_submissions WHERE id = $1', [id]);
    if (!rows[0]) throw nichtGefunden('Feedback');
    if (felder.length && rows[0].organization_id) await meldeAenderung(this.pool, { table: 'feedback_submissions', organizationId: rows[0].organization_id, operation: 'UPDATE', id });
    return (await this.zeile(id)) as Record<string, unknown>;
  }

  /**
   * Rückmeldung an die meldende Person. Mit `senden` geht die Mail über die Outbox (in derselben Transaktion wie die Markierung,
   * also genau einmal); ohne Konto der Person gibt es keinen Empfänger. Eine Meldung wird nur einmal beantwortet.
   */
  async antworten(id: string, eingabe: { text: string; senden: boolean }): Promise<Record<string, unknown>> {
    const text = eingabe.text.trim();
    if (!text) throw ungueltig('Text fehlt');

    await inTransaction(this.pool, async (db) => {
      const { rows } = await db.query<{ description: string; organization_id: string | null; replied_at: Date | null; email: string | null }>(
        `SELECT f.description, f.organization_id, f.replied_at, u.email::text AS email
           FROM feedback_submissions f LEFT JOIN auth_users u ON u.id = f.user_id WHERE f.id = $1 FOR UPDATE OF f`,
        [id]
      );
      const meldung = rows[0];
      if (!meldung) throw nichtGefunden('Feedback');
      if (meldung.replied_at) throw konflikt('already_replied', 'Diese Meldung wurde bereits beantwortet');
      if (eingabe.senden && !meldung.email) throw konflikt('no_recipient', 'Zu dieser Meldung gibt es kein Konto mit E-Mail-Adresse; als manuell beantwortet markieren');

      if (eingabe.senden && meldung.email) {
        const mail = feedbackRueckmeldungMail(text, meldung.description);
        await reiheMailsEin(db, [{ organizationId: meldung.organization_id, kind: 'feedback_reply', recipient: meldung.email, subject: mail.subject, text: mail.text, html: mail.html, useOrgSmtp: false }]);
      }
      await db.query('UPDATE feedback_submissions SET reply_text = $2, replied_at = now() WHERE id = $1', [id, text]);
      if (meldung.organization_id) await meldeAenderung(db, { table: 'feedback_submissions', organizationId: meldung.organization_id, operation: 'UPDATE', id });
    });
    return (await this.zeile(id)) as Record<string, unknown>;
  }
}
