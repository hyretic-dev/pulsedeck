import type { AddressInfo } from 'node:net';

import { simpleParser, type ParsedMail } from 'mailparser';
import { SMTPServer } from 'smtp-server';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { erstelleFixture, type Fixture } from '../../test/fixture';
import { MailOutbox } from '../jobs/mail-outbox';
import { SchedulerService } from '../jobs/scheduler.service';

/**
 * Newsletter, Outbox und Scheduler gegen echtes PostgreSQL (und einen lokalen SMTP-Server für den Organisations-SMTP).
 * Alpha: Olga (Admin), Clara (Vorstand), Anna und Paul (Mitglieder); Beta: Bernd (Admin), Clara (Mitglied).
 */
describe('Newsletter und Outbox (echtes PostgreSQL)', () => {
  let f: Fixture;
  let ids: Fixture['ids'];
  let outbox: MailOutbox;
  const n = (org: string, rest = '') => `/api/v1/orgs/${org}/newsletter${rest}`;
  const feed = (org: string, rest = '') => `/api/v1/orgs/${org}/feed${rest}`;

  async function freigegeben(titel: string, konto = ids.clara, org = ids.alpha, extra: object = {}): Promise<string> {
    const antwort = await f.api('post', feed(org), konto, { title: titel, type: 'article', content: '<p>Text</p>', status: 'approved', ...extra });
    expect(antwort.status, JSON.stringify(antwort.body)).toBe(201);
    return antwort.body.id;
  }
  const outboxZeilen = async (org: string, art = 'newsletter') =>
    (await f.admin.query('SELECT recipient, status, use_org_smtp, subject, html_body, text_body FROM mail_outbox WHERE organization_id = $1 AND kind = $2 ORDER BY recipient', [org, art])).rows;

  beforeAll(async () => {
    f = await erstelleFixture('pulsedeck_newsletter_test', { smtpAllowPrivateHosts: true });
    ids = f.ids;
    outbox = f.app.get(MailOutbox);
    await f.admin.query("UPDATE members SET status = 'Inactive' WHERE id = $1", [ids.paulMitglied]);
  });
  afterAll(async () => {
    await f.schliessen();
  });
  beforeEach(() => {
    f.pgApp.transport.send.mockReset().mockResolvedValue(undefined);
  });

  it('zeigt die Konfiguration nur Administratoren, legt Standardwerte an und liefert nie ein Passwort', async () => {
    const antwort = await f.api('get', n(ids.alpha, '/config'), ids.olga);

    expect(antwort.status).toBe(200);
    expect(antwort.body).toMatchObject({ organization_id: ids.alpha, frequency: 'weekly', active: false, smtp_host: null, smtp_pass_set: false });
    expect(JSON.stringify(antwort.body)).not.toMatch(/smtp_pass_encrypted|"smtp_pass"/);
    for (const konto of [ids.anna, ids.clara]) expect((await f.api('get', n(ids.alpha, '/config'), konto)).status, konto).toBe(403);
    expect((await f.api('get', n(ids.alpha, '/config'), ids.bernd)).status).toBe(403);
    expect((await f.api('get', n(ids.alpha, '/config'), null)).status).toBe(401);
    expect((await f.api('get', n(ids.beta, '/config'), ids.bernd)).body.organization_id).toBe(ids.beta); // je Organisation eine Zeile
  });

  it('prüft Eingaben und verweigert interne SMTP-Ziele, falsche Ports und fehlende Absender', async () => {
    const patch = (body: object) => f.api('patch', n(ids.alpha, '/config'), ids.olga, body);
    for (const falsch of [
      { frequency: 'daily' }, { day_of_week: 7 }, { time_of_day: '25' }, { primary_color: 'rot' }, { logo_url: 'javascript:alert(1)' },
      { smtp_host: 'mail.example.org', smtp_from: 'kein absender' }, { smtp_host: 'mail.example.org' }, { id: 1 }, { organization_id: ids.beta },
      { smtp_host: 'x.example.org', smtp_from: 'a@b.example', smtp_port: 5432 },
    ]) {
      expect((await patch(falsch)).status, JSON.stringify(falsch)).toBe(400);
    }
    expect((await f.api('patch', n(ids.alpha, '/config'), ids.clara, { active: true })).status).toBe(403);
  });

  it('speichert das SMTP-Passwort nur verschlüsselt, meldet nur „gesetzt“ und löscht es mit dem Server', async () => {
    const gesetzt = await f.api('patch', n(ids.alpha, '/config'), ids.olga, { smtp_host: '127.0.0.1', smtp_port: 2525, smtp_user: 'mailer', smtp_pass: 'sehr-geheim', smtp_from: 'Verein <verein@example.org>', smtp_secure: false });

    expect(gesetzt.status).toBe(200);
    expect(gesetzt.body).toMatchObject({ smtp_host: '127.0.0.1', smtp_port: 2525, smtp_user: 'mailer', smtp_pass_set: true, smtp_from: 'Verein <verein@example.org>' });
    expect(JSON.stringify(gesetzt.body)).not.toContain('sehr-geheim');
    const roh = (await f.admin.query('SELECT smtp_pass_encrypted FROM newsletter_config WHERE organization_id = $1', [ids.alpha])).rows[0].smtp_pass_encrypted;
    expect(roh).toMatch(/^v1\./);
    expect(roh).not.toContain('sehr-geheim');
    const audit = JSON.stringify((await f.admin.query("SELECT new_data FROM audit_logs WHERE table_name = 'newsletter_config' AND organization_id = $1", [ids.alpha])).rows);
    expect(audit).not.toContain('sehr-geheim');
    expect(audit).not.toContain('v1.');

    const entfernt = await f.api('patch', n(ids.alpha, '/config'), ids.olga, { smtp_host: '' });
    expect(entfernt.body).toMatchObject({ smtp_host: null, smtp_user: null, smtp_from: null, smtp_pass_set: false });
    expect((await f.admin.query('SELECT smtp_pass_encrypted FROM newsletter_config WHERE organization_id = $1', [ids.alpha])).rows[0].smtp_pass_encrypted).toBeNull();
  });

  it('setzt beim Einschalten den Versandzeitpunkt als Ausgangspunkt (kein sofortiges Nachholen)', async () => {
    const vorher = await f.api('get', n(ids.beta, '/config'), ids.bernd);
    expect(vorher.body.last_sent_at).toBeNull();

    const an = await f.api('patch', n(ids.beta, '/config'), ids.bernd, { active: true, frequency: 'weekly', day_of_week: 5, time_of_day: '12:00' });

    expect(an.body.active).toBe(true);
    expect(an.body.last_sent_at).not.toBeNull();
  });

  it('reiht den Newsletter nur an aktive Mitglieder der Organisation ein, setzt Beiträge auf versendet und maskiert Inhalte', async () => {
    const boese = await freigegeben('<script>alert(1)</script> Wichtig', ids.clara, ids.alpha, { url: 'https://example.org/a?x=1&y=2' });
    await freigegeben('Zweiter Beitrag', ids.olga);
    await freigegeben('Beta-Beitrag', ids.bernd, ids.beta);
    await f.api('post', feed(ids.alpha), ids.anna, { title: 'Nur Entwurf', type: 'article' });

    expect((await f.api('post', n(ids.alpha, '/send'), ids.clara)).status).toBe(403);
    const antwort = await f.api('post', n(ids.alpha, '/send'), ids.olga);

    expect(antwort.status).toBe(200);
    expect(antwort.body).toMatchObject({ sent: true, items: 2, recipients: 3 }); // Olga, Clara, Anna – Paul ist inaktiv
    const zeilen = await outboxZeilen(ids.alpha);
    expect(zeilen.map((z) => z.recipient)).toEqual(['anna-10@example.org', 'clara-10@example.org', 'olga-10@example.org']);
    expect(zeilen.every((z) => z.status === 'pending' && z.use_org_smtp === false)).toBe(true);
    expect(zeilen[0].html_body).not.toContain('<script>');
    expect(zeilen[0].html_body).toContain('&lt;script&gt;');
    expect(zeilen[0].html_body).toContain('https://example.org/a?x=1&amp;y=2');
    expect(zeilen[0].subject).toContain('Alpha e. V.');
    const beitraege = await f.admin.query("SELECT status, sent_at IS NOT NULL AS gesendet FROM feed_items WHERE organization_id = $1 ORDER BY title", [ids.alpha]);
    expect(beitraege.rows.filter((r) => r.status === 'sent')).toHaveLength(2);
    expect(beitraege.rows.find((r) => r.status === 'draft')).toBeTruthy();
    expect((await f.admin.query("SELECT status FROM feed_items WHERE title = 'Beta-Beitrag'")).rows[0].status).toBe('approved'); // andere Organisation unberührt
    expect((await outboxZeilen(ids.beta))).toHaveLength(0);
    expect((await f.api('post', n(ids.alpha, '/send'), ids.olga)).body).toMatchObject({ sent: false, items: 0 }); // nichts mehr zu senden
    expect(boese).toBeTruthy();
  });

  it('verändert nichts, wenn es keine Empfänger gibt (Transaktion): Beiträge bleiben freigegeben', async () => {
    await f.admin.query("UPDATE members SET status = 'Inactive' WHERE organization_id = $1", [ids.beta]);
    await f.admin.query("UPDATE members SET status = 'Inactive' WHERE organization_id = $1 AND id = $2", [ids.beta, ids.claraBeta]);

    const antwort = await f.api('post', n(ids.beta, '/send'), ids.bernd);

    expect(antwort.status).toBe(409);
    expect(antwort.body.code).toBe('no_recipients');
    expect((await f.admin.query("SELECT status FROM feed_items WHERE title = 'Beta-Beitrag'")).rows[0].status).toBe('approved');
    expect(await outboxZeilen(ids.beta)).toHaveLength(0);
    await f.admin.query("UPDATE members SET status = 'Active' WHERE organization_id = $1", [ids.beta]);
  });

  it('versendet über die Outbox, markiert Erfolg und wiederholt Fehlschläge mit Backoff bis zum endgültigen Fehler', async () => {
    const erfolg = await outbox.leeren();
    expect(erfolg).toEqual({ gesendet: 3, wiederholt: 0, fehlgeschlagen: 0 });
    expect(f.pgApp.transport.send).toHaveBeenCalledTimes(3);
    expect(f.pgApp.transport.send.mock.calls[0][0]).toMatchObject({ subject: expect.stringContaining('Alpha e. V.'), html: expect.stringContaining('Wichtig') });

    await freigegeben('Dritter Beitrag', ids.olga);
    await f.api('post', n(ids.alpha, '/send'), ids.olga);
    f.pgApp.transport.send.mockRejectedValue(new Error('SMTP-Zustellung fehlgeschlagen (code=ECONNREFUSED)'));
    const fehler = await outbox.leeren();
    expect(fehler).toEqual({ gesendet: 0, wiederholt: 3, fehlgeschlagen: 0 });
    const zeile = (await f.admin.query("SELECT status, attempts, last_error, next_attempt_at > now() AS spaeter FROM mail_outbox WHERE status = 'pending' LIMIT 1")).rows[0];
    expect(zeile).toMatchObject({ status: 'pending', attempts: 1, spaeter: true });
    expect(zeile.last_error).toContain('ECONNREFUSED');
    expect(await outbox.leeren()).toEqual({ gesendet: 0, wiederholt: 0, fehlgeschlagen: 0 }); // Backoff: noch nicht fällig

    // Fünf Versuche, dann endgültig fehlgeschlagen
    for (let versuch = 2; versuch <= 5; versuch += 1) {
      await f.admin.query("UPDATE mail_outbox SET next_attempt_at = now() WHERE status = 'pending'");
      const ergebnis = await outbox.leeren();
      expect(ergebnis.gesendet).toBe(0);
      if (versuch === 5) expect(ergebnis.fehlgeschlagen).toBe(3);
    }
    expect((await f.admin.query("SELECT count(*)::int AS n FROM mail_outbox WHERE status = 'failed'")).rows[0].n).toBe(3);
  });

  it('verteilt parallele Outbox-Läufe ohne Doppelversand', async () => {
    await f.admin.query('DELETE FROM mail_outbox');
    await f.admin.query(
      `INSERT INTO mail_outbox (organization_id, kind, recipient, subject, text_body, html_body)
       SELECT $1, 'newsletter', 'empfaenger' || g || '@example.org', 's', 't', 'h' FROM generate_series(1, 40) g`,
      [ids.alpha]
    );

    const [a, b, c] = await Promise.all([outbox.leeren(40), outbox.leeren(40), outbox.leeren(40)]);

    expect(a.gesendet + b.gesendet + c.gesendet).toBe(40);
    const empfaenger = f.pgApp.transport.send.mock.calls.map((aufruf) => (aufruf[0] as { to: string }).to);
    expect(new Set(empfaenger).size).toBe(40);
    expect(empfaenger).toHaveLength(40);
  });

  describe('SMTP der Organisation', () => {
    let smtp: SMTPServer;
    const empfangen: ParsedMail[] = [];

    beforeAll(async () => {
      smtp = new SMTPServer({
        authOptional: true, logger: false, disabledCommands: ['STARTTLS', 'AUTH'],
        onData(stream, _s, callback) {
          simpleParser(stream).then((mail) => { empfangen.push(mail); callback(); }).catch(callback);
        },
      });
      await new Promise<void>((ok) => smtp.listen(2525, '127.0.0.1', ok));
      expect((smtp.server.address() as AddressInfo).port).toBe(2525);
    });
    afterAll(async () => {
      await new Promise<void>((ok) => smtp.close(() => ok()));
    });

    it('stellt Testmail und Newsletter über den SMTP-Server der Organisation zu', async () => {
      await f.api('patch', n(ids.alpha, '/config'), ids.olga, { smtp_host: '127.0.0.1', smtp_port: 2525, smtp_from: 'Alpha <alpha@example.org>', smtp_secure: false });
      await f.admin.query('DELETE FROM mail_outbox');

      const test = await f.api('post', n(ids.alpha, '/test'), ids.olga, { email: ' Test@Example.org ' });
      expect(test.status).toBe(200);
      expect(empfangen).toHaveLength(1);
      expect(empfangen[0].to).toMatchObject({ value: [{ address: 'test@example.org' }] });
      expect(empfangen[0].subject).toContain('[Vorschau]');
      expect(empfangen[0].from?.value[0].address).toBe('alpha@example.org');
      expect(f.pgApp.transport.send).not.toHaveBeenCalled(); // nicht über die Plattform

      await freigegeben('Über Org-SMTP', ids.olga);
      await f.api('post', n(ids.alpha, '/send'), ids.olga);
      expect((await outboxZeilen(ids.alpha)).every((z) => z.use_org_smtp)).toBe(true);
      const lauf = await outbox.leeren();
      expect(lauf.gesendet).toBe(3);
      expect(empfangen).toHaveLength(4);
      expect(f.pgApp.transport.send).not.toHaveBeenCalled();
    });

    it('meldet fehlgeschlagene Testmails als 502 ohne Serverdetails und begrenzt die Anzahl', async () => {
      await new Promise<void>((ok) => smtp.close(() => ok()));
      const antwort = await f.api('post', n(ids.alpha, '/test'), ids.olga, { email: 'test@example.org' });
      expect(antwort.status).toBe(502);
      expect(antwort.body.code).toBe('mail_delivery_failed');
      expect(JSON.stringify(antwort.body)).not.toMatch(/127\.0\.0\.1|ECONNREFUSED/);
      smtp = new SMTPServer({ logger: false, disabledCommands: ['STARTTLS', 'AUTH'], onData(stream, _s, cb) { stream.resume(); stream.on('end', () => cb()); } });
      await new Promise<void>((ok) => smtp.listen(2525, '127.0.0.1', ok));

      expect((await f.api('post', n(ids.alpha, '/test'), ids.olga, { email: 'kaputt' })).status).toBe(400);
      expect((await f.api('post', n(ids.alpha, '/test'), ids.clara, { email: 'a@example.org' })).status).toBe(403);
    });
  });

  it('versendet fällige Newsletter im Scheduler genau einmal, auch bei parallelen Ticks', async () => {
    await f.admin.query("UPDATE members SET status = 'Active'");
    await f.admin.query("UPDATE newsletter_config SET smtp_host = NULL, smtp_pass_encrypted = NULL, smtp_user = NULL, smtp_from = NULL WHERE organization_id = $1", [ids.alpha]);
    await f.admin.query("UPDATE newsletter_config SET active = true, frequency = 'weekly', day_of_week = EXTRACT(dow FROM now() AT TIME ZONE 'Europe/Berlin')::int, time_of_day = '00:00', last_sent_at = now() - interval '9 days' WHERE organization_id = $1", [ids.alpha]);
    await f.admin.query('DELETE FROM mail_outbox');
    await freigegeben('Zeitplan-Beitrag', ids.olga);
    const scheduler = f.app.get(SchedulerService);
    await f.admin.query("DELETE FROM scheduler_state");

    await Promise.all([scheduler.tick(), scheduler.tick()]);
    await scheduler.tick();

    const zeilen = await outboxZeilen(ids.alpha);
    expect(zeilen).toHaveLength(4); // vier aktive Mitglieder, einmal
    expect((await f.admin.query('SELECT last_sent_at > now() - interval \'1 minute\' AS frisch FROM newsletter_config WHERE organization_id = $1', [ids.alpha])).rows[0].frisch).toBe(true);
    await f.admin.query("DELETE FROM scheduler_state");
    await freigegeben('Noch einer', ids.olga);
    await scheduler.tick();
    expect(await outboxZeilen(ids.alpha)).toHaveLength(4); // nicht erneut fällig → nichts Neues
  });
});
