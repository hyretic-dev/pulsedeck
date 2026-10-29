import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { erstelleFixture, type Fixture } from '../../test/fixture';

import { berlinUhr, berlinZeitpunkt } from './zeit';

const ab = (tage: number) => berlinUhr(new Date(Date.now() + tage * 86_400_000));
const datum = (tage: number) => {
  const u = ab(tage);
  return `${u.jahr}-${String(u.monat).padStart(2, '0')}-${String(u.tag).padStart(2, '0')}`;
};
const slot = (tage: number, von: number, bis: number) => {
  const u = ab(tage);
  return { start_at: berlinZeitpunkt(u.jahr, u.monat, u.tag, von).toISOString(), end_at: berlinZeitpunkt(u.jahr, u.monat, u.tag, bis).toISOString() };
};

/** Öffentliche Belegungsansicht: nur angenommene, öffentliche Buchungen mit Titel und Zeitraum, sonst nichts. */
describe('Öffentliche Belegung (echtes PostgreSQL)', () => {
  let f: Fixture;
  let ids: Fixture['ids'];
  let oeffentlich: string;
  let intern: string;
  const p = (org = ids.alpha, rest = '') => `/api/v1/orgs/${org}/booking-calendars${rest}`;
  const pub = (slug: string, rest = '') => `/api/v1/public/organizations/${slug}/booking-calendars${rest}`;
  const ok = (a: { status: number; body: any }) => {
    expect(a.status, JSON.stringify(a.body)).toBeLessThan(300);
    return a.body;
  };
  const liste = async (plan = oeffentlich, slug = 'alpha') => (await f.api('get', pub(slug, `/${plan}/bookings?from=${datum(0)}&to=${datum(120)}`))).body as any[];

  beforeAll(async () => {
    f = await erstelleFixture('pulsedeck_public_bookings_test');
    ids = f.ids;
    oeffentlich = ok(await f.api('post', p(), ids.olga, { name: 'Bürgerhaus Saal', kind: 'place', address: 'Marktstraße 12', state: 'NW', public_view: 'month' })).id;
    intern = ok(await f.api('post', p(), ids.olga, { name: 'Vorstandsbüro', kind: 'place' })).id;
    ok(await f.api('put', p(ids.alpha, `/${oeffentlich}/members/${ids.annaMitglied}`), ids.olga, { role: 'requester' }));
  });
  afterAll(async () => {
    await f.schliessen();
  });

  it('zeigt anonym nur Pläne mit öffentlicher Anzeige und deren Einstellungen, nichts über Personen', async () => {
    const antwort = await f.api('get', pub('alpha'));
    expect(antwort.status).toBe(200);
    expect(antwort.body).toEqual([
      { id: oeffentlich, name: 'Bürgerhaus Saal', kind: 'place', address: 'Marktstraße 12', state: 'NW', window_start: 8, window_end: 22, public_view: 'month' },
    ]);
    expect((await f.api('get', pub('unbekannt'))).body).toEqual([]);
    expect((await f.api('get', pub('beta'))).body).toEqual([]); // Beta hat keinen öffentlichen Plan
  });

  it('liefert nur angenommene und öffentliche Buchungen mit Titel und Zeitraum, nie Namen oder Notizen', async () => {
    ok(await f.api('post', p(ids.alpha, `/${oeffentlich}/bookings`), ids.olga, { title: 'Offenes Fest', note: 'Geheime Notiz', is_public: true, ...slot(10, 10, 12) }));
    ok(await f.api('post', p(ids.alpha, `/${oeffentlich}/bookings`), ids.olga, { title: 'Internes Treffen', is_public: false, ...slot(11, 10, 12) }));
    const offen = ok(await f.api('post', p(ids.alpha, `/${oeffentlich}/bookings`), ids.anna, { title: 'Offene Anfrage', is_public: true, ...slot(12, 10, 12) }));
    const abgelehnt = ok(await f.api('post', p(ids.alpha, `/${oeffentlich}/bookings`), ids.anna, { title: 'Abgelehnt', is_public: true, ...slot(13, 10, 12) }));
    ok(await f.api('post', `/api/v1/orgs/${ids.alpha}/bookings/${abgelehnt.id}/decline`, ids.olga, {}));
    const storniert = ok(await f.api('post', p(ids.alpha, `/${oeffentlich}/bookings`), ids.olga, { title: 'Storniert', is_public: true, ...slot(14, 10, 12) }));
    ok(await f.api('post', `/api/v1/orgs/${ids.alpha}/bookings/${storniert.id}/cancel`, ids.olga));
    void offen;

    const heraus = await liste();
    expect(heraus.map((b) => b.title)).toEqual(['Offenes Fest']);
    expect(Object.keys(heraus[0]).sort()).toEqual(['end_at', 'event_id', 'id', 'start_at', 'title']);
    expect(JSON.stringify(heraus)).not.toMatch(/Geheime Notiz|Olga|Anna|requester|member_id|note/);
    expect(heraus[0].event_id).toBeNull();
  });

  it('gibt für nicht öffentliche Pläne, fremde Organisationen und Zufalls-IDs dieselbe 404 und lässt Fremde nichts erraten', async () => {
    ok(await f.api('post', p(ids.alpha, `/${intern}/bookings`), ids.olga, { title: 'Im Büro', is_public: true, ...slot(10, 10, 12) }));
    const q = `?from=${datum(0)}&to=${datum(30)}`;
    expect((await f.api('get', pub('alpha', `/${intern}/bookings${q}`))).status).toBe(404); // Plan ohne öffentliche Anzeige
    expect((await f.api('get', pub('beta', `/${oeffentlich}/bookings${q}`))).status).toBe(404); // Plan einer anderen Organisation
    expect((await f.api('get', pub('unbekannt', `/${oeffentlich}/bookings${q}`))).status).toBe(404);
    expect((await f.api('get', pub('alpha', `/${ids.unbekannt}/bookings${q}`))).status).toBe(404);
    expect((await f.api('get', pub('alpha', `/abc/bookings${q}`))).status).toBe(400);
  });

  it('prüft den Zeitraum: Format, Reihenfolge und höchstens gut ein Jahr', async () => {
    const r = (von: string, bis: string) => f.api('get', pub('alpha', `/${oeffentlich}/bookings?from=${von}&to=${bis}`));
    expect((await r('kaputt', datum(5))).status).toBe(400);
    expect((await r(datum(5), datum(1))).status).toBe(400);
    expect((await r(datum(0), datum(500))).status).toBe(400);
    expect((await r(datum(0), datum(395))).status).toBe(200);
    expect((await f.api('get', pub('alpha', `/${oeffentlich}/bookings`))).status).toBe(400);
  });

  it('verknüpft mit öffentlichen Terminen und zeigt Titel und Öffentlichkeit des Termins; nicht öffentliche Termine fehlen', async () => {
    const termin = (extra: object) => ({ title: 'T', date: datum(20), start_time: '19:00', end_time: '21:00', location: '', location_type: 'onsite', booking_calendar_id: oeffentlich, ...extra });
    const offen = ok(await f.api('post', `/api/v1/orgs/${ids.alpha}/events`, ids.olga, termin({ title: 'Öffentliches Konzert', allowed_roles: ['public', 'member', 'committee', 'admin'] })));
    ok(await f.api('post', `/api/v1/orgs/${ids.alpha}/events`, ids.olga, termin({ title: 'Nur für Mitglieder', date: datum(21), allowed_roles: ['member', 'committee', 'admin'] })));
    const heraus = await liste();
    const konzert = heraus.find((b) => b.title === 'Öffentliches Konzert');
    expect(konzert).toMatchObject({ event_id: offen.id });
    expect(heraus.map((b) => b.title)).not.toContain('Nur für Mitglieder');
    // Termin wird nicht mehr öffentlich → die Buchung verschwindet sofort (kein Kopieren)
    ok(await f.api('patch', `/api/v1/orgs/${ids.alpha}/events/${offen.id}`, ids.olga, { allowed_roles: ['member', 'committee', 'admin'] }));
    expect((await liste()).map((b) => b.title)).not.toContain('Öffentliches Konzert');
  });

  it('zeigt nur Buchungen im angefragten Zeitraum, einschließlich mehrtägiger über den Rand hinweg', async () => {
    const u = ab(40);
    const v = ab(42);
    ok(await f.api('post', p(ids.alpha, `/${oeffentlich}/bookings`), ids.olga, {
      title: 'Mehrtägig', is_public: true,
      start_at: berlinZeitpunkt(u.jahr, u.monat, u.tag, 18).toISOString(), end_at: berlinZeitpunkt(v.jahr, v.monat, v.tag, 12).toISOString(),
    }));
    const q = (von: number, bis: number) => f.api('get', pub('alpha', `/${oeffentlich}/bookings?from=${datum(von)}&to=${datum(bis)}`)).then((r) => r.body.map((b: any) => b.title));
    expect(await q(41, 41)).toContain('Mehrtägig'); // mittendrin
    expect(await q(42, 45)).toContain('Mehrtägig'); // letzter Tag
    expect(await q(43, 50)).not.toContain('Mehrtägig');
    expect(await q(30, 39)).not.toContain('Mehrtägig');
  });

  it('nimmt den Plan aus der öffentlichen Ansicht, sobald die Leitung sie abschaltet', async () => {
    ok(await f.api('patch', p(ids.alpha, `/${oeffentlich}`), ids.olga, { public_view: 'none' }));
    expect((await f.api('get', pub('alpha'))).body).toEqual([]);
    expect((await f.api('get', pub('alpha', `/${oeffentlich}/bookings?from=${datum(0)}&to=${datum(30)}`))).status).toBe(404);
  });
});
