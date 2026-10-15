import { Inject, Injectable } from '@nestjs/common';
import type { Pool } from 'pg';

import { schreibeAudit } from '../common/audit';
import { meldeAenderung } from '../common/changes';
import { inTransaction, type Queryable } from '../common/db';
import { apiFehler, konflikt, ungueltig } from '../common/http-error';
import { SECRET_BOX, type SecretBox } from '../common/secret-box';
import { APP_CONFIG, istAbsender, type AppConfig } from '../config/configuration';
import { PG_POOL } from '../infrastructure/postgres/pg.pool';
import { reiheMailsEin } from '../jobs/mail-outbox';
import { pruefeSmtpZiel } from '../mail/smtp-host-guard';

import { baueOrgTransport, newsletterKontext } from './org-smtp';
import { istFaellig } from './newsletter.schedule';
import { newsletterMail, type NewsletterBeitrag } from './newsletter.template';

const STANDARD_PORT = 587;
const OEFFENTLICHE_SPALTEN = 'organization_id, frequency, day_of_week, time_of_day, last_sent_at, active, logo_url, footer_text, primary_color, smtp_host, smtp_port, smtp_user, smtp_from, smtp_secure';

export interface ConfigEingabe {
  frequency?: string;
  day_of_week?: number;
  time_of_day?: string;
  active?: boolean;
  logo_url?: string;
  footer_text?: string;
  primary_color?: string;
  smtp_host?: string | null;
  smtp_port?: number;
  smtp_user?: string | null;
  smtp_pass?: string | null;
  smtp_from?: string | null;
  smtp_secure?: boolean;
}
const EINFACHE_FELDER = ['frequency', 'day_of_week', 'time_of_day', 'active', 'logo_url', 'footer_text', 'primary_color'] as const;

@Injectable()
export class NewsletterService {
  constructor(
    @Inject(PG_POOL) private readonly pool: Pool,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(SECRET_BOX) private readonly geheimnisse: SecretBox
  ) {}

  private async sichereZeile(db: Queryable, orgId: string): Promise<void> {
    await db.query('INSERT INTO newsletter_config (organization_id) VALUES ($1) ON CONFLICT (organization_id) DO NOTHING', [orgId]);
  }

  /** Konfiguration ohne Passwort: `smtp_pass_set` zeigt nur, ob eines hinterlegt ist. */
  async konfiguration(orgId: string, db: Queryable = this.pool): Promise<Record<string, unknown>> {
    await this.sichereZeile(db, orgId);
    const { rows } = await db.query(`SELECT ${OEFFENTLICHE_SPALTEN}, smtp_pass_encrypted IS NOT NULL AS smtp_pass_set FROM newsletter_config WHERE organization_id = $1`, [orgId]);
    return rows[0];
  }

  async aktualisieren(userId: string, orgId: string, eingabe: ConfigEingabe): Promise<Record<string, unknown>> {
    return inTransaction(this.pool, async (db) => {
      await this.sichereZeile(db, orgId);
      const { rows: alt } = await db.query('SELECT * FROM newsletter_config WHERE organization_id = $1 FOR UPDATE', [orgId]);
      const werte: Record<string, unknown> = {};
      for (const feld of EINFACHE_FELDER) if (eingabe[feld] !== undefined) werte[feld] = eingabe[feld];
      // Beim Einschalten gilt „jetzt“ als Ausgangspunkt, sonst würde sofort der letzte planmäßige Termin nachgeholt.
      if (eingabe.active === true && !alt[0].active && !alt[0].last_sent_at) werte.last_sent_at = new Date();

      if (eingabe.smtp_host !== undefined) {
        const host = (eingabe.smtp_host ?? '').trim();
        if (!host) {
          Object.assign(werte, { smtp_host: null, smtp_user: null, smtp_pass_encrypted: null, smtp_from: null });
        } else {
          const port = eingabe.smtp_port ?? alt[0].smtp_port ?? STANDARD_PORT;
          const from = eingabe.smtp_from ?? alt[0].smtp_from;
          if (!from || !istAbsender(from)) throw ungueltig('Für einen eigenen SMTP-Server ist eine gültige Absenderadresse nötig');
          await pruefeSmtpZiel(host, port, this.config.smtpAllowPrivateHosts);
          Object.assign(werte, { smtp_host: host, smtp_port: port, smtp_from: from.trim() });
        }
      } else if (eingabe.smtp_port !== undefined || eingabe.smtp_from !== undefined) {
        if (alt[0].smtp_host) {
          const port = eingabe.smtp_port ?? alt[0].smtp_port ?? STANDARD_PORT;
          const from = eingabe.smtp_from ?? alt[0].smtp_from;
          if (!from || !istAbsender(from)) throw ungueltig('Ungültige Absenderadresse');
          await pruefeSmtpZiel(alt[0].smtp_host, port, this.config.smtpAllowPrivateHosts);
          Object.assign(werte, { smtp_port: port, smtp_from: from.trim() });
        }
      }
      if (eingabe.smtp_user !== undefined && werte.smtp_host !== null) werte.smtp_user = eingabe.smtp_user || null;
      if (eingabe.smtp_secure !== undefined) werte.smtp_secure = eingabe.smtp_secure;
      if (eingabe.smtp_pass !== undefined && werte.smtp_host !== null) {
        werte.smtp_pass_encrypted = eingabe.smtp_pass ? this.geheimnisse.seal(eingabe.smtp_pass, newsletterKontext(orgId)) : null;
      }

      const spalten = Object.keys(werte);
      if (spalten.length > 0) {
        await db.query(`UPDATE newsletter_config SET ${spalten.map((s, i) => `${s} = $${i + 2}`).join(', ')} WHERE organization_id = $1`, [orgId, ...spalten.map((s) => werte[s])]);
        // Audit nennt nur geänderte Felder, nie Werte (Geheimnisse).
        await schreibeAudit(db, { table: 'newsletter_config', operation: 'UPDATE', recordId: null, newData: { changed: spalten.map((s) => (s === 'smtp_pass_encrypted' ? 'smtp_pass' : s)) }, performedBy: userId, organizationId: orgId });
        await meldeAenderung(db, { table: 'newsletter_config', organizationId: orgId, operation: 'UPDATE', id: null });
      }
      return this.konfiguration(orgId, db);
    });
  }

  private async beitraege(db: Queryable, orgId: string, nurFreigegebene = true): Promise<Array<NewsletterBeitrag & { id: string }>> {
    const { rows } = await db.query(
      `SELECT f.id, f.title, f.content, f.url, f.created_at, a.name AS author_name
         FROM feed_items f JOIN members a ON a.id = f.author_id
        WHERE f.organization_id = $1 ${nurFreigegebene ? "AND f.status = 'approved'" : ''} ORDER BY f.created_at DESC`,
      [orgId]
    );
    return rows;
  }

  private async gestaltung(db: Queryable, orgId: string, cfg: Record<string, any>) {
    const { rows } = await db.query<{ name: string }>('SELECT name FROM organizations WHERE id = $1', [orgId]);
    return { organisation: rows[0]?.name ?? 'PulseDeck', logo_url: cfg.logo_url || null, footer_text: cfg.footer_text || null, primary_color: cfg.primary_color || null, appBaseUrl: this.config.appBaseUrl };
  }

  /** Testmail sofort und synchron, damit Fehlkonfigurationen (SMTP) sofort sichtbar werden. */
  async testen(orgId: string, an: string): Promise<{ message: string }> {
    const cfg = await this.konfiguration(orgId);
    const warteschlange = await this.beitraege(this.pool, orgId);
    const beispiel: NewsletterBeitrag[] = warteschlange.length > 0 ? warteschlange : [{ title: 'Beispielbeitrag', content: 'So sieht ein Beitrag im Newsletter aus.', url: null, created_at: new Date(), author_name: 'PulseDeck' }];
    const mail = newsletterMail(beispiel, await this.gestaltung(this.pool, orgId, cfg));
    const orgTransport = await baueOrgTransport(this.pool, orgId, this.geheimnisse, this.config.smtpAllowPrivateHosts).catch((fehler) => {
      if ((fehler as { status?: number }).status) throw fehler;
      throw apiFehler(502, 'smtp_secret_unreadable', 'Das gespeicherte SMTP-Passwort ist nicht lesbar; bitte neu eingeben');
    });
    if (!orgTransport) return this.testPlattform(an, mail);
    try {
      await orgTransport.send({ to: an, subject: `[Vorschau] ${mail.subject}`, text: mail.text, html: mail.html });
    } catch {
      throw apiFehler(502, 'mail_delivery_failed', 'Die Testmail konnte über den konfigurierten SMTP-Server nicht zugestellt werden');
    }
    return { message: 'Testmail gesendet' };
  }

  private async testPlattform(an: string, mail: { subject: string; text: string; html: string }): Promise<{ message: string }> {
    await reiheMailsEin(this.pool, [{ organizationId: null, kind: 'newsletter_test', recipient: an, subject: `[Vorschau] ${mail.subject}`, text: mail.text, html: mail.html, useOrgSmtp: false }]);
    return { message: 'Testmail eingereiht (Plattform-Versand)' };
  }

  /**
   * Newsletter versenden: reiht je aktivem Mitglied der Organisation (mit E-Mail) eine Outbox-Mail ein, setzt die
   * Beiträge auf `sent` und `last_sent_at` – alles in einer Transaktion. Zustellung und Wiederholung übernimmt die Outbox.
   * Die Adressen stammen nur aus dieser Organisation (der Bestand mailte an alle Mitglieder aller Organisationen).
   */
  async versenden(userId: string | null, orgId: string, optionen: { erzwingen: boolean; nurWennFaellig?: boolean }): Promise<{ sent: boolean; message: string; items: number; recipients: number }> {
    return inTransaction(this.pool, async (db) => {
      await this.sichereZeile(db, orgId);
      const { rows } = await db.query('SELECT * FROM newsletter_config WHERE organization_id = $1 FOR UPDATE', [orgId]);
      const cfg = rows[0];
      if (!optionen.erzwingen && !cfg.active) return { sent: false, message: 'Newsletter ist inaktiv', items: 0, recipients: 0 };
      if (optionen.nurWennFaellig && !istFaellig(cfg, cfg.last_sent_at, new Date(), this.config.timeZone)) return { sent: false, message: 'Noch nicht fällig', items: 0, recipients: 0 };
      const beitraege = await this.beitraege(db, orgId);
      if (beitraege.length === 0) return { sent: false, message: 'Keine neuen Beiträge zum Versenden', items: 0, recipients: 0 };
      const { rows: empfaenger } = await db.query<{ email: string }>(
        "SELECT DISTINCT ON (lower(email)) email FROM members WHERE organization_id = $1 AND status = 'Active' AND email IS NOT NULL AND email <> '' ORDER BY lower(email)",
        [orgId]
      );
      if (empfaenger.length === 0) throw konflikt('no_recipients', 'Es gibt keine aktiven Mitglieder mit E-Mail-Adresse');
      const mail = newsletterMail(beitraege, await this.gestaltung(db, orgId, cfg));
      await reiheMailsEin(db, empfaenger.map((e) => ({ organizationId: orgId, kind: 'newsletter', recipient: e.email, subject: mail.subject, text: mail.text, html: mail.html, useOrgSmtp: !!cfg.smtp_host })));
      await db.query("UPDATE feed_items SET status = 'sent', sent_at = now(), updated_at = now() WHERE id = ANY($1::uuid[])", [beitraege.map((b) => b.id)]);
      await db.query('UPDATE newsletter_config SET last_sent_at = now() WHERE organization_id = $1', [orgId]);
      await schreibeAudit(db, { table: 'newsletter_config', operation: 'UPDATE', recordId: null, newData: { sent_items: beitraege.length, recipients: empfaenger.length }, performedBy: userId, organizationId: orgId });
      await meldeAenderung(db, { table: 'feed_items', organizationId: orgId, operation: 'UPDATE', id: null });
      return { sent: true, message: 'Newsletter wird versendet', items: beitraege.length, recipients: empfaenger.length };
    });
  }

  /** Scheduler: versendet alle fälligen Newsletter. Jede Organisation läuft in eigener Transaktion mit Zeilensperre. */
  async faelligeVersenden(): Promise<number> {
    const { rows } = await this.pool.query<{ organization_id: string }>("SELECT organization_id FROM newsletter_config WHERE active AND frequency IN ('weekly', 'monthly')");
    let versendet = 0;
    for (const { organization_id } of rows) {
      try {
        const ergebnis = await this.versenden(null, organization_id, { erzwingen: false, nurWennFaellig: true });
        if (ergebnis.sent) versendet += 1;
      } catch {
        // Fehler einer Organisation (z. B. keine Empfänger) dürfen die anderen nicht blockieren; nächster Tick versucht es erneut.
      }
    }
    return versendet;
  }
}
