import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { erstelleFixture, type Fixture } from '../../test/fixture';

import { seedeDemoOrtsverband } from './seed-demo-ortsverband';

describe('Demo-Organisation Ortsverband (echtes PostgreSQL)', () => {
  let f: Fixture;
  let pool: Pool;
  const heute = new Date(Date.UTC(2026, 10, 2));

  beforeAll(async () => {
    f = await erstelleFixture('pulsedeck_demo_seed_test');
    pool = new Pool({ connectionString: f.pgApp.config.databaseUrl, max: 2 }); // Runtime-Rolle, wie im Betrieb
  });
  afterAll(async () => {
    await pool.end();
    await f.schliessen();
  });
  const seed = (optionen: Partial<Parameters<typeof seedeDemoOrtsverband>[1]> = {}) =>
    seedeDemoOrtsverband(pool, { besitzerEmail: 'dora@example.org', heute, ...optionen });
  const zaehle = async (tabelle: string, orgId: string, spalte = 'organization_id'): Promise<number> =>
    (await f.admin.query(`SELECT count(*)::int AS n FROM ${tabelle} WHERE ${spalte} = $1`, [orgId])).rows[0].n;

  it('legt Arbeitsgruppen, Serientermine, Schichten, Wiki, Feed und Umfrage an, mit dem Konto als Admin', async () => {
    const e = await seed();

    expect(e).toMatchObject({ slug: 'demo-ortsverband', mitglieder: 13, arbeitsgruppen: 4, wikiSeiten: 5 });
    const org = (await f.admin.query('SELECT name, owner_id FROM organizations WHERE id = $1', [e.organizationId])).rows[0];
    expect(org).toMatchObject({ name: 'Ortsverband Musterstadt', owner_id: f.ids.dora });
    expect(await zaehle('members', e.organizationId)).toBe(13);
    expect((await f.admin.query("SELECT app_role FROM members WHERE organization_id = $1 AND user_id = $2", [e.organizationId, f.ids.dora])).rows[0].app_role).toBe('admin');
    expect(await zaehle('working_groups', e.organizationId)).toBe(4);
    expect(await zaehle('events', e.organizationId)).toBe(e.termine);
    expect(await zaehle('event_slots', e.organizationId)).toBe(e.schichten);
    expect(await zaehle('wiki_docs', e.organizationId)).toBe(5);

    // Serien: Eltern + Folgetermine, Folgetermine zeigen auf den Eltern-Termin
    const serien = (await f.admin.query('SELECT count(*)::int AS n FROM events WHERE organization_id = $1 AND recurrence_parent_id IS NOT NULL', [e.organizationId])).rows[0].n;
    expect(serien).toBeGreaterThanOrEqual(5);
    // Schichten sind teils besetzt, teils offen (Demo soll beides zeigen)
    const belegung = (await f.admin.query(
      `SELECT count(*) FILTER (WHERE (SELECT count(*) FROM event_slot_signups s WHERE s.slot_id = es.id) = 0)::int AS offen,
              count(*) FILTER (WHERE (SELECT count(*) FROM event_slot_signups s WHERE s.slot_id = es.id) > 0)::int AS belegt
         FROM event_slots es WHERE organization_id = $1`, [e.organizationId])).rows[0];
    expect(belegung.offen).toBeGreaterThan(0);
    expect(belegung.belegt).toBeGreaterThan(0);
    // Alle Termine liegen in der Zukunft relativ zum Bezugstag
    expect((await f.admin.query("SELECT count(*)::int AS n FROM events WHERE organization_id = $1 AND date < '2026-11-02'", [e.organizationId])).rows[0].n).toBe(0);
    // Umfrage mit Stimmen, angepinnter Beitrag mit Lesebestätigungen
    expect((await f.admin.query("SELECT count(*)::int AS n FROM poll_votes v JOIN poll_options o ON o.id = v.option_id JOIN feed_items i ON i.id = o.feed_item_id WHERE i.organization_id = $1", [e.organizationId])).rows[0].n).toBe(7);
    expect((await f.admin.query('SELECT count(*)::int AS n FROM feed_items WHERE organization_id = $1 AND is_pinned', [e.organizationId])).rows[0].n).toBe(1);

    // Die Demo ist über die echte API lesbar
    expect((await f.api('get', '/api/v1/public/organizations/demo-ortsverband', null)).status).toBe(200);
    expect((await f.api('get', `/api/v1/orgs/${e.organizationId}/events`, f.ids.dora)).status).toBe(200);
  });

  it('verwendet nur nicht zustellbare Adressen für erfundene Personen', async () => {
    const adressen = (await f.admin.query("SELECT email::text AS email FROM members WHERE organization_id = (SELECT id FROM organizations WHERE slug = 'demo-ortsverband') AND user_id IS NULL")).rows;
    expect(adressen).toHaveLength(12);
    expect(adressen.every((a: { email: string }) => a.email.endsWith('.invalid'))).toBe(true);
    expect((await f.admin.query("SELECT count(*)::int AS n FROM mail_outbox")).rows[0].n).toBe(0);
  });

  it('bricht ohne --reset ab, setzt mit --reset sauber zurück und kennt unbekannte Konten nicht', async () => {
    await expect(seed()).rejects.toThrow(/gibt es schon/);
    await expect(seed({ besitzerEmail: 'niemand@example.org', slug: 'demo-zwei' })).rejects.toThrow(/Kein Konto/);

    const neu = await seed({ zuruecksetzen: true });

    expect((await f.admin.query("SELECT count(*)::int AS n FROM organizations WHERE slug = 'demo-ortsverband'")).rows[0].n).toBe(1);
    expect(await zaehle('members', neu.organizationId)).toBe(13);
    expect((await f.admin.query("SELECT count(*)::int AS n FROM members WHERE email::text LIKE '%musterstadt.invalid'")).rows[0].n).toBe(12); // keine Reste der ersten Anlage
  });
});
