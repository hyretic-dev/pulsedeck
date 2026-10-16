import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { erstelleFixture, type Fixture } from '../../test/fixture';
import { frischesFenster } from '../../test/rate-window';

const inTagen = (n: number): string => new Date(Date.now() + n * 86_400_000).toISOString().split('T')[0];

/** iCal-Abonnement und Sitemap gegen echtes PostgreSQL: Token-Rechte, öffentliche Sicht, Maskierung, Token-Wechsel, Rate-Limit. */
describe('Kalender-Abo und Sitemap (echtes PostgreSQL)', () => {
  let f: Fixture;
  let ids: Fixture['ids'];
  let technik: string;
  const tokenVon = async (memberId: string) => (await f.admin.query('SELECT calendar_token FROM members WHERE id = $1', [memberId])).rows[0].calendar_token as string;
  const ical = (query: string) => f.api('get', `/api/v1/public/ical?${query}`, null);
  const summaries = (ics: string) => [...ics.matchAll(/^SUMMARY:(.*)$/gm)].map((m) => m[1]).sort();

  beforeAll(async () => {
    f = await erstelleFixture('pulsedeck_calendar_test');
    ids = f.ids;
    technik = (await f.admin.query("INSERT INTO working_groups (organization_id, name, description, lead, next_meeting, contact_type, contact_icon) VALUES ($1, 'Technik', 'd', 'l', 'n', 'Email', 'pi-envelope') RETURNING id", [ids.alpha])).rows[0].id;
    await f.admin.query("INSERT INTO ag_memberships (working_group_id, member_id, role) VALUES ($1, $2, 'member')", [technik, ids.annaMitglied]);
    const ev = (org: string, titel: string, datum: string, rollen: string, ag: string | null = null) =>
      f.admin.query(`INSERT INTO events (organization_id, title, date, start_time, end_time, location, allowed_roles, working_group_id) VALUES ($1, $2, $3, '19:00', '21:00', 'Halle', '${rollen}', $4)`, [org, titel, datum, ag]);
    await ev(ids.alpha, 'E-oeffentlich', inTagen(5), '{public,member,committee,admin}');
    await ev(ids.alpha, 'E-mitglieder', inTagen(6), '{member,committee,admin}');
    await ev(ids.alpha, 'E-vorstand', inTagen(7), '{committee,admin}');
    await ev(ids.alpha, 'E-admin', inTagen(8), '{admin}');
    await ev(ids.alpha, 'E-ag', inTagen(9), '{}', technik);
    await ev(ids.alpha, 'E-alt', inTagen(-60), '{public,member,committee,admin}');
    await ev(ids.alpha, 'E-kuerzlich', inTagen(-10), '{public,member,committee,admin}');
    await ev(ids.beta, 'E-beta', inTagen(5), '{public,member,committee,admin}');
  });
  afterAll(async () => {
    await f.schliessen();
  });
  beforeEach(async () => {
    await f.admin.query('DELETE FROM rate_limits');
  });

  it('liefert mit Token genau die Termine, die das Mitglied in der App sieht', async () => {
    const sicht = async (memberId: string) => summaries((await ical(`token=${await tokenVon(memberId)}`)).text);

    expect(await sicht(ids.paulMitglied)).toEqual(['E-kuerzlich', 'E-mitglieder', 'E-oeffentlich']);
    expect(await sicht(ids.annaMitglied)).toEqual(['E-ag', 'E-kuerzlich', 'E-mitglieder', 'E-oeffentlich']);
    expect(await sicht(ids.claraAlpha)).toEqual(['E-kuerzlich', 'E-mitglieder', 'E-oeffentlich', 'E-vorstand']);
    expect(await sicht(ids.olgaMitglied)).toEqual(['E-admin', 'E-ag', 'E-kuerzlich', 'E-mitglieder', 'E-oeffentlich', 'E-vorstand']); // nie E-alt (älter als 30 Tage) und nie E-beta
    expect(await sicht(ids.berndMitglied)).toEqual(['E-beta']);
  });

  it('antwortet mit korrekten Kopfzeilen und Format', async () => {
    const token = await tokenVon(ids.annaMitglied);

    const mitDownload = await ical(`token=${token}`);
    const ohneDownload = await ical(`token=${token}&download=false`);

    expect(mitDownload.status).toBe(200);
    expect(mitDownload.headers['content-type']).toBe('text/calendar; charset=utf-8');
    expect(mitDownload.headers['cache-control']).toBe('private, no-store');
    expect(mitDownload.headers['content-disposition']).toBe('attachment; filename="PulseDeck_Kalender.ics"');
    expect(ohneDownload.headers['content-disposition']).toBeUndefined();
    expect(mitDownload.text.startsWith('BEGIN:VCALENDAR\r\n')).toBe(true);
    expect(mitDownload.text).toMatch(/DTSTART:\d{8}T\d{6}Z/);
  });

  it('weist ungültige Token ab, ohne auf öffentliche Daten zurückzufallen', async () => {
    for (const token of ['falsch', '0'.repeat(32), `${await tokenVon(ids.annaMitglied)}x`]) {
      const antwort = await ical(`token=${token}&org=${ids.alpha}`);
      expect(antwort.status, token).toBe(401);
      expect(antwort.text).not.toContain('BEGIN:VCALENDAR');
    }
  });

  it('zeigt ohne Token nur öffentliche Termine der gewählten Organisation (ID oder Kürzel)', async () => {
    const perId = await ical(`org=${ids.alpha}`);
    const perKuerzel = await ical('org=alpha');

    expect(summaries(perId.text)).toEqual(['E-kuerzlich', 'E-oeffentlich']);
    expect(summaries(perKuerzel.text)).toEqual(['E-kuerzlich', 'E-oeffentlich']);
    expect(perId.headers['cache-control']).toBe('public, max-age=300');
    expect((await ical('org=gibt-es-nicht')).status).toBe(404);
    expect((await ical('')).status).toBe(400);
  });

  it('filtert nach Arbeitsgruppe und benennt den Kalender; prüft die Gruppen-ID', async () => {
    const token = await tokenVon(ids.annaMitglied);

    const antwort = await ical(`token=${token}&ag=${technik}`);

    expect(summaries(antwort.text)).toEqual(['E-ag']);
    expect(antwort.text).toContain('X-WR-CALNAME:PulseDeck - Technik');
    expect(antwort.headers['content-disposition']).toBe('attachment; filename="PulseDeck_-_Technik.ics"');
    expect((await ical(`token=${token}&ag=keine-uuid`)).status).toBe(400);
    expect(summaries((await ical(`token=${await tokenVon(ids.paulMitglied)}&ag=${technik}`)).text)).toEqual([]); // Paul darf E-ag nicht sehen
  });

  it('kann über Titel, Beschreibung oder Ort keine iCal-Felder einschleusen', async () => {
    await f.admin.query("INSERT INTO events (organization_id, title, date, start_time, location, description, allowed_roles) VALUES ($1, $2, $3, '10:00', $4, $5, '{public}')", [
      ids.alpha, 'Böse\r\nEND:VEVENT\r\nBEGIN:VEVENT\r\nSUMMARY:Gefälscht', inTagen(3), 'Ort\r\nATTENDEE:mailto:x@example.org', 'Zeile1\nURL:http://evil.example',
    ]);

    const ics = (await ical(`org=${ids.alpha}`)).text;

    expect(ics.match(/^BEGIN:VEVENT\r$/gm)).toHaveLength(3); // nur echte Zeilen zählen, der maskierte Text steht in SUMMARY
    expect(ics).not.toMatch(/^(ATTENDEE|URL):/m);
    expect(ics).not.toMatch(/^SUMMARY:Gefälscht/m);
    expect(ics).toContain('\\nEND:VEVENT\\n');
  });

  it('erneuert den Kalender-Token: der alte Link erlischt, der neue gilt, nur für das eigene Mitglied', async () => {
    const alt = await tokenVon(ids.annaMitglied);
    const paulsToken = await tokenVon(ids.paulMitglied);

    const antwort = await f.api('post', `/api/v1/orgs/${ids.alpha}/calendar/token`, ids.anna);

    expect(antwort.status).toBe(201);
    expect(antwort.body.calendar_token).toMatch(/^[0-9a-f]{32}$/);
    expect(antwort.body.calendar_token).not.toBe(alt);
    expect((await ical(`token=${alt}`)).status).toBe(401);
    expect((await ical(`token=${antwort.body.calendar_token}`)).status).toBe(200);
    expect(await tokenVon(ids.paulMitglied)).toBe(paulsToken);
    expect((await f.api('post', `/api/v1/orgs/${ids.alpha}/calendar/token`, ids.bernd)).status).toBe(403);
    expect((await f.api('post', `/api/v1/orgs/${ids.alpha}/calendar/token`, null)).status).toBe(401);
    const audit = JSON.stringify((await f.admin.query("SELECT new_data FROM audit_logs WHERE table_name = 'members' AND record_id = $1", [ids.annaMitglied])).rows);
    expect(audit).not.toContain(antwort.body.calendar_token);
  });

  it('begrenzt die Abrufe je Absender', async () => {
    await frischesFenster();
    const token = await tokenVon(ids.paulMitglied);
    for (let i = 0; i < 120; i += 1) await ical(`org=${ids.alpha}`);

    expect((await ical(`token=${token}`)).status).toBe(429);
  });

  it('liefert die Sitemap mit festen Seiten und allen Organisationen, maskiert und zwischengespeichert', async () => {
    await f.admin.query("INSERT INTO organizations (slug, name) VALUES ('a&b<c', 'Sonderzeichen')");

    const antwort = await f.api('get', '/api/v1/public/sitemap.xml', null);

    expect(antwort.status).toBe(200);
    expect(antwort.headers['content-type']).toBe('application/xml; charset=utf-8');
    expect(antwort.headers['cache-control']).toBe('public, max-age=3600');
    expect(antwort.text.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true);
    for (const pfad of ['https://app.pulsedeck.example</loc>', 'https://app.pulsedeck.example/login', 'https://app.pulsedeck.example/alpha</loc>', 'https://app.pulsedeck.example/beta</loc>']) expect(antwort.text).toContain(pfad);
    expect(antwort.text).toContain('/a%26b%3Cc</loc>');
    expect(antwort.text).not.toContain('a&b<c');
  });

  it('liefert robots.txt mit der Sitemap-Adresse dieser Instanz', async () => {
    const antwort = await f.api('get', '/api/v1/public/robots.txt', null);

    expect(antwort.status).toBe(200);
    expect(antwort.headers['content-type']).toBe('text/plain; charset=utf-8');
    expect(antwort.text).toBe('User-agent: *\nAllow: /\n\nSitemap: https://app.pulsedeck.example/sitemap.xml\n');
  });
});
