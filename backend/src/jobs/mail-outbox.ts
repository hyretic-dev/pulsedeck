import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Pool } from 'pg';

import type { Queryable } from '../common/db';
import { SECRET_BOX, type SecretBox } from '../common/secret-box';
import { APP_CONFIG, type AppConfig } from '../config/configuration';
import { PG_POOL } from '../infrastructure/postgres/pg.pool';
import { MAIL_TRANSPORT, type MailTransport } from '../mail/mail-transport';
import { baueOrgTransport } from '../newsletter/org-smtp';

export interface OutboxMail {
  organizationId: string | null;
  kind: string;
  recipient: string;
  subject: string;
  text: string;
  html: string;
  /** true → über den SMTP-Server der Organisation (sofern dort konfiguriert), sonst über den Plattform-Transport. */
  useOrgSmtp: boolean;
}

export const OUTBOX_MAX_VERSUCHE = 5;

/** Reiht Mails in derselben Transaktion ein, die auch die auslösende Änderung schreibt (E5: Nebenwirkung genau einmal oder gar nicht). */
export async function reiheMailsEin(db: Queryable, mails: OutboxMail[]): Promise<void> {
  if (mails.length === 0) return;
  await db.query(
    `INSERT INTO mail_outbox (organization_id, kind, recipient, subject, text_body, html_body, use_org_smtp)
     SELECT * FROM unnest($1::uuid[], $2::text[], $3::text[], $4::text[], $5::text[], $6::text[], $7::boolean[])`,
    [
      mails.map((m) => m.organizationId),
      mails.map((m) => m.kind),
      mails.map((m) => m.recipient),
      mails.map((m) => m.subject),
      mails.map((m) => m.text),
      mails.map((m) => m.html),
      mails.map((m) => m.useOrgSmtp),
    ]
  );
}

interface OutboxZeile {
  id: string;
  organization_id: string | null;
  recipient: string;
  subject: string;
  text_body: string;
  html_body: string;
  use_org_smtp: boolean;
  attempts: number;
}

/**
 * Versendet die Outbox mit Wiederholung (Backoff 1, 2, 4, 8 Minuten, danach `failed`). Mehrere Instanzen
 * dürfen parallel arbeiten: `FOR UPDATE SKIP LOCKED` verteilt die Zeilen, eine abgestürzte Instanz gibt
 * ihre Zeilen nach Ablauf der Sperre wieder frei.
 */
@Injectable()
export class MailOutbox {
  private readonly logger = new Logger('MailOutbox');

  constructor(
    @Inject(PG_POOL) private readonly pool: Pool,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(SECRET_BOX) private readonly geheimnisse: SecretBox,
    @Inject(MAIL_TRANSPORT) private readonly plattform: MailTransport
  ) {}

  async leeren(batch = 25): Promise<{ gesendet: number; wiederholt: number; fehlgeschlagen: number }> {
    const { rows } = await this.pool.query<OutboxZeile>(
      `WITH faellig AS (
         SELECT id FROM mail_outbox
          WHERE status = 'pending' AND next_attempt_at <= now() AND (locked_until IS NULL OR locked_until < now())
          ORDER BY next_attempt_at LIMIT $1 FOR UPDATE SKIP LOCKED)
       UPDATE mail_outbox m SET locked_until = now() + interval '5 minutes', attempts = m.attempts + 1
         FROM faellig WHERE m.id = faellig.id
       RETURNING m.id, m.organization_id, m.recipient, m.subject, m.text_body, m.html_body, m.use_org_smtp, m.attempts`,
      [batch]
    );
    const ergebnis = { gesendet: 0, wiederholt: 0, fehlgeschlagen: 0 };
    const transporte = new Map<string, MailTransport | null>();
    for (const zeile of rows) {
      try {
        const transport = await this.transportFuer(zeile, transporte);
        await transport.send({ to: zeile.recipient, subject: zeile.subject, text: zeile.text_body, html: zeile.html_body });
        await this.pool.query("UPDATE mail_outbox SET status = 'sent', sent_at = now(), locked_until = NULL, last_error = NULL WHERE id = $1", [zeile.id]);
        ergebnis.gesendet += 1;
      } catch (fehler) {
        const endgueltig = zeile.attempts >= OUTBOX_MAX_VERSUCHE;
        const grund = fehler instanceof Error ? fehler.message.slice(0, 300) : 'unbekannter Fehler';
        this.logger.warn(`Outbox ${zeile.id}: Versuch ${zeile.attempts} fehlgeschlagen (${grund})`);
        await this.pool.query(
          `UPDATE mail_outbox SET status = $2, locked_until = NULL, last_error = $3,
                  next_attempt_at = now() + make_interval(mins => $4) WHERE id = $1`,
          [zeile.id, endgueltig ? 'failed' : 'pending', grund, 2 ** (zeile.attempts - 1)]
        );
        if (endgueltig) ergebnis.fehlgeschlagen += 1;
        else ergebnis.wiederholt += 1;
      }
    }
    return ergebnis;
  }

  private async transportFuer(zeile: OutboxZeile, cache: Map<string, MailTransport | null>): Promise<MailTransport> {
    if (!zeile.use_org_smtp || !zeile.organization_id) return this.plattform;
    if (!cache.has(zeile.organization_id)) {
      cache.set(zeile.organization_id, await baueOrgTransport(this.pool, zeile.organization_id, this.geheimnisse, this.config.smtpAllowPrivateHosts));
    }
    return cache.get(zeile.organization_id) ?? this.plattform; // SMTP der Organisation inzwischen entfernt → Plattform-Versand
  }

  /** Bereinigung: versendete Zeilen nach 30 Tagen, fehlgeschlagene nach 90 Tagen. */
  async bereinigen(): Promise<void> {
    await this.pool.query(
      "DELETE FROM mail_outbox WHERE (status = 'sent' AND sent_at < now() - interval '30 days') OR (status = 'failed' AND created_at < now() - interval '90 days')"
    );
  }
}
