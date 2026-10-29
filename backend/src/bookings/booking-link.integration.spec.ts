import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { erstelleFixture, type Fixture } from '../../test/fixture';

import { berlinUhr } from './zeit';

const datum = (tage: number): string => {
  const u = berlinUhr(new Date(Date.now() + tage * 86_400_000));
  return `${u.jahr}-${String(u.monat).padStart(2, '0')}-${String(u.tag).padStart(2, '0')}`;
};

/**
 * Termine mit Ortsreservierung: Termin und Buchung entstehen und ändern sich in einer Transaktion.
 * Saal: Olga = Leitung (Admin), Paul = Verwaltung, Clara = Buchende (Vorstand, darf Termine anlegen), Anna = Mitglied ohne Rolle.
 */
describe('Termine mit Ort (echtes PostgreSQL)', () => {
  let f: Fixture;
  let ids: Fixture['ids'];
  let saal: string;
  let rad: string;
  const e = (rest = '') => `/api/v1/orgs/${ids.alpha}/events${rest}`;
  const p = (rest = '') => `/api/v1/orgs/${ids.alpha}/booking-calendars${rest}`;
  const termin = (tage: number, extra: object = {}) => ({
    title: 'Bündnistreffen', date: datum(tage), start_time: '19:30', end_time: '21:15', location: '', location_type: 'onsite', booking_calendar_id: saal, ...extra,
  });
  const ok = (a: { status: number; body: any }) => {
    expect(a.status, JSON.stringify(a.body)).toBeLessThan(300);
    return a.body;
  };
  const anzahlTermine = async () => (await f.admin.query('SELECT count(*)::int AS n FROM events WHERE organization_id = $1', [ids.alpha])).rows[0].n;
  const buchung = async (eventId: string) => (await f.admin.query('SELECT id, calendar_id, status, starts_at, ends_at, title FROM bookings WHERE event_id = $1 ORDER BY created_at', [eventId])).rows;
  const mails = async (kind: string) => (await f.admin.query('SELECT id, recipient, subject FROM mail_outbox WHERE kind = $1', [kind])).rows as Array<{ id: string; recipient: string; subject: string }>;

  beforeAll(async () => {
    f = await erstelleFixture('pulsedeck_booking_link_test');
    ids = f.ids;
    saal = ok(await f.api('post', p(), ids.olga, { name: 'Bürgerhaus Saal', kind: 'place', address: 'Marktstraße 12' })).id;
    rad = ok(await f.api('post', p(), ids.olga, { name: 'Lastenrad', kind: 'item' })).id;
    for (const [mitglied, rolle] of [[ids.paulMitglied, 'manager'], [ids.claraAlpha, 'requester']]) {
      ok(await f.api('put', p(`/${saal}/members/${mitglied}`), ids.olga, { role: rolle }));
    }
  });
  afterAll(async () => {
    await f.schliessen();
  });

  it('legt Termin und angenommene Buchung in einer Transaktion an (Leitung) und rundet auf volle Stunden', async () => {
    const t = ok(await f.api('post', e(), ids.olga, termin(30)));
    expect(t.location).toBe('Bürgerhaus Saal, Marktstraße 12'); // leeres Ortsfeld: Name und Adresse des Plans
    expect(t.booking).toMatchObject({ calendar_id: saal, calendar_name: 'Bürgerhaus Saal', status: 'approved' });
    const [b] = await buchung(t.id);
    expect(b).toMatchObject({ status: 'approved', title: null }); // Titel kommt aus dem Termin
    expect(berlinUhr(b.starts_at)).toMatchObject({ stunde: 19, minute: 0 }); // 19:30 → 19 Uhr
    expect(berlinUhr(b.ends_at)).toMatchObject({ stunde: 22, minute: 0 }); // 21:15 → 22 Uhr
  });

  it('stellt als Buchende eine offene Anfrage und benachrichtigt die Verwaltung', async () => {
    const vorher = await mails('booking_request');
    const t = ok(await f.api('post', e(), ids.clara, termin(31, { title: 'Vorstandssitzung', location: 'Nebenraum' })));
    expect(t.location).toBe('Nebenraum'); // vorhandene Ortsangabe bleibt
    expect(t.booking.status).toBe('requested');
    const neu = (await mails('booking_request')).filter((m) => !vorher.some((v) => v.id === m.id));
    expect(neu.map((m) => m.recipient).sort()).toEqual(['olga-10@example.org', 'paul-10@example.org']);
    expect(neu[0].subject).toContain('Vorstandssitzung');
  });

  it('speichert bei belegtem Zeitraum nichts: 409, kein Termin, keine Buchung', async () => {
    ok(await f.api('post', e(), ids.olga, termin(32, { title: 'Erster' })));
    const vorher = await anzahlTermine();
    const antwort = await f.api('post', e(), ids.olga, termin(32, { title: 'Zweiter', start_time: '20:00', end_time: '21:00' }));
    expect(antwort.status).toBe(409);
    expect(antwort.body).toMatchObject({ code: 'booking_conflict' });
    expect(await anzahlTermine()).toBe(vorher);
    // als Anfrage ist dieselbe Überschneidung mit einer angenommenen Buchung ebenfalls belegt
    expect((await f.api('post', e(), ids.clara, termin(32, { title: 'Dritter' }))).status).toBe(409);
    expect(await anzahlTermine()).toBe(vorher);
  });

  it('prüft die Reservierung: nur bei Vor Ort, mit Endzeit, nur Orte, Zeitfenster, Rolle, Organisation', async () => {
    const vorher = await anzahlTermine();
    const faelle: Array<[string, object, number]> = [
      ['online', termin(40, { location_type: 'zoom' }), 400],
      ['ohne Ortsart', termin(40, { location_type: undefined }), 400],
      ['ohne Endzeit', termin(40, { end_time: undefined }), 400],
      ['Gegenstand', termin(40, { booking_calendar_id: rad }), 400],
      ['vor dem Zeitfenster', termin(40, { start_time: '06:00', end_time: '09:00' }), 400],
      ['nach dem Zeitfenster', termin(40, { start_time: '21:00', end_time: '22:30' }), 400],
      ['unbekannter Plan', termin(40, { booking_calendar_id: ids.unbekannt }), 404],
      ['kaputte ID', termin(40, { booking_calendar_id: 'abc' }), 400],
    ];
    for (const [name, daten, status] of faelle) expect((await f.api('post', e(), ids.olga, daten)).status, name).toBe(status);
    // Plan einer anderen Organisation
    const fremd = ok(await f.api('post', `/api/v1/orgs/${ids.beta}/booking-calendars`, ids.bernd, { name: 'Beta-Saal', kind: 'place' })).id;
    expect((await f.api('post', e(), ids.olga, termin(40, { booking_calendar_id: fremd }))).status).toBe(404);
    // Vorstand ohne Rolle im Plan darf nicht reservieren
    ok(await f.api('delete', p(`/${saal}/members/${ids.claraAlpha}`), ids.olga));
    expect((await f.api('post', e(), ids.clara, termin(40))).status).toBe(403);
    ok(await f.api('put', p(`/${saal}/members/${ids.claraAlpha}`), ids.olga, { role: 'requester' }));
    expect(await anzahlTermine()).toBe(vorher);
  });

  it('reserviert Terminserien nur für die Leitung und speichert bei einem belegten Datum nichts', async () => {
    const start = datum(50);
    const serie = (konto: string, extra: object = {}) => f.api('post', e(), konto, termin(50, { title: 'Stammtisch', is_recurring: true, recurrence_interval: 'biweekly', ...extra }));
    const vorher = await anzahlTermine();
    expect((await serie(ids.clara)).status).toBe(403); // Buchende
    expect((await serie(ids.paul)).status).toBe(403); // Verwaltung ist nicht Leitung (und ohne events:create ohnehin)
    expect(await anzahlTermine()).toBe(vorher);

    // zweites Folgedatum belegen (50 + 28 Tage), dann scheitert die ganze Serie und nennt das Datum
    ok(await f.api('post', e(), ids.olga, termin(78, { title: 'Hindernis', start_time: '20:00', end_time: '21:00' })));
    const nachHindernis = await anzahlTermine();
    const kaputt = await serie(ids.olga);
    expect(kaputt.status).toBe(409);
    expect(kaputt.body.message).toContain(datum(78));
    expect(await anzahlTermine()).toBe(nachHindernis);

    // ohne Hindernis: jeder Termin der Serie hat eine angenommene Buchung
    const frei = ok(await f.api('post', e(), ids.olga, termin(200, { title: 'Freie Serie', is_recurring: true, recurrence_interval: 'biweekly' })));
    const { rows } = await f.admin.query(
      `SELECT count(*)::int AS termine, count(b.id)::int AS buchungen, count(*) FILTER (WHERE b.status = 'approved')::int AS angenommen
         FROM events ev LEFT JOIN bookings b ON b.event_id = ev.id WHERE ev.id = $1 OR ev.recurrence_parent_id = $1`,
      [frei.id]
    );
    expect(rows[0].termine).toBeGreaterThan(5);
    expect(rows[0].buchungen).toBe(rows[0].termine);
    expect(rows[0].angenommen).toBe(rows[0].termine);
    void start;
  });

  it('lässt die Buchung mit dem Termin mitziehen: Verwaltung bleibt angenommen, Buchende wird wieder offene Anfrage', async () => {
    // Olga (Leitung) verschiebt ihren Termin
    const t = ok(await f.api('post', e(), ids.olga, termin(60, { title: 'Verschiebbar' })));
    const verschoben = ok(await f.api('patch', e(`/${t.id}`), ids.olga, { start_time: '16:00', end_time: '18:00' }));
    expect(verschoben.booking.status).toBe('approved');
    const [b] = await buchung(t.id);
    expect(berlinUhr(b.starts_at).stunde).toBe(16);
    expect(berlinUhr(b.ends_at).stunde).toBe(18);
    // auf belegt verschieben: 409, der Termin bleibt unverändert (gleiche Transaktion)
    ok(await f.api('post', e(), ids.olga, termin(60, { title: 'Blockade', start_time: '19:00', end_time: '21:00' })));
    expect((await f.api('patch', e(`/${t.id}`), ids.olga, { start_time: '19:30', end_time: '20:30' })).status).toBe(409);
    expect((await f.api('get', e(`/${t.id}`), ids.olga)).body).toMatchObject({ start_time: '16:00', end_time: '18:00' });

    // Clara (Buchende): angenommen durch Paul, dann verschiebt sie → wieder offen
    const c = ok(await f.api('post', e(), ids.clara, termin(61, { title: 'Claras Termin' })));
    const claraBuchung = (await buchung(c.id))[0];
    ok(await f.api('post', `/api/v1/orgs/${ids.alpha}/bookings/${claraBuchung.id}/approve`, ids.paul));
    expect((await f.api('get', e(`/${c.id}`), ids.clara)).body.booking.status).toBe('approved');
    const vorher = await mails('booking_request');
    const geaendert = ok(await f.api('patch', e(`/${c.id}`), ids.clara, { start_time: '17:00', end_time: '18:00' }));
    expect(geaendert.booking.status).toBe('requested');
    expect((await mails('booking_request')).length).toBe(vorher.length + 2); // Olga und Paul
    expect((await f.admin.query('SELECT decided_by FROM bookings WHERE id = $1', [claraBuchung.id])).rows[0].decided_by).toBeNull();
  });

  it('sperrt Datum und Uhrzeit ohne Rolle im Plan (403), Titel und andere Felder bleiben änderbar', async () => {
    const t = ok(await f.api('post', e(), ids.clara, termin(62, { title: 'Ohne Rolle später' })));
    ok(await f.api('delete', p(`/${saal}/members/${ids.claraAlpha}`), ids.olga));
    expect((await f.api('patch', e(`/${t.id}`), ids.clara, { date: datum(63) })).status).toBe(403);
    expect((await f.api('patch', e(`/${t.id}`), ids.clara, { start_time: '10:00', end_time: '11:00' })).status).toBe(403);
    expect((await f.api('get', e(`/${t.id}`), ids.clara)).body).toMatchObject({ date: datum(62), start_time: '19:30' });
    ok(await f.api('patch', e(`/${t.id}`), ids.clara, { title: 'Nur umbenannt', description: 'Neu' }));
    ok(await f.api('put', p(`/${saal}/members/${ids.claraAlpha}`), ids.olga, { role: 'requester' }));
  });

  it('storniert beim Entfernen oder Wechseln des Ortes die alte Buchung und legt ggf. eine neue an', async () => {
    const zweiterSaal = ok(await f.api('post', p(), ids.olga, { name: 'Sporthalle', kind: 'place' })).id;
    const t = ok(await f.api('post', e(), ids.olga, termin(70, { title: 'Umzug' })));
    // wechseln
    const gewechselt = ok(await f.api('patch', e(`/${t.id}`), ids.olga, { booking_calendar_id: zweiterSaal }));
    expect(gewechselt.booking).toMatchObject({ calendar_id: zweiterSaal, status: 'approved' });
    const nachWechsel = await buchung(t.id);
    expect(nachWechsel.map((b) => [b.calendar_id === saal ? 'saal' : 'halle', b.status])).toEqual([['saal', 'cancelled'], ['halle', 'approved']]);
    // der alte Ort ist wieder frei
    ok(await f.api('post', e(), ids.olga, termin(70, { title: 'Nachfolger' })));
    // entfernen
    const ohne = ok(await f.api('patch', e(`/${t.id}`), ids.olga, { booking_calendar_id: null }));
    expect(ohne.booking).toMatchObject({ status: 'cancelled' }); // Verlauf bleibt sichtbar als „storniert“
    expect((await buchung(t.id)).every((b) => b.status === 'cancelled')).toBe(true);
    // wieder reservieren: die stornierte Buchung blockiert nichts (nur eine wirksame Buchung je Termin)
    expect(ok(await f.api('patch', e(`/${t.id}`), ids.olga, { booking_calendar_id: zweiterSaal })).booking.status).toBe('approved');
    // „Vor Ort“ aufgeben: die Reservierung entfällt
    const online = ok(await f.api('patch', e(`/${t.id}`), ids.olga, { location_type: 'zoom' }));
    expect(online.booking.status).toBe('cancelled');
  });

  it('lässt die Buchung entfallen, wenn der Termin gelöscht wird, und gibt den Ort frei', async () => {
    const t = ok(await f.api('post', e(), ids.olga, termin(80, { title: 'Wird gelöscht' })));
    expect((await f.api('delete', e(`/${t.id}`), ids.anna)).status).toBe(403); // keine Berechtigung für den Termin
    expect((await buchung(t.id)).length).toBe(1);
    expect((await f.api('delete', e(`/${t.id}`), ids.olga)).status).toBe(204);
    expect((await buchung(t.id)).length).toBe(0);
    expect((await f.api('post', e(), ids.olga, termin(80, { title: 'Nachfolger' }))).status).toBe(201);
  });

  it('übernimmt Titel und Öffentlichkeit immer aus dem Termin und maskiert sie nach der Terminsichtbarkeit', async () => {
    const intern = ok(await f.api('post', e(), ids.olga, termin(90, { title: 'Nur Vorstand', allowed_roles: ['committee', 'admin'] })));
    const offen = ok(await f.api('post', e(), ids.olga, termin(91, { title: 'Für alle', allowed_roles: ['public', 'member', 'committee', 'admin'] })));
    const lies = async (konto: string) => (await f.api('get', p(`/${saal}/bookings?from=${datum(89)}&to=${datum(92)}`), konto)).body as any[];
    const finde = (liste: any[], eventId: string) => liste.find((b) => b.event_id === eventId);
    ok(await f.api('put', p(`/${saal}/members/${ids.annaMitglied}`), ids.olga, { role: 'requester' }));

    // Anna: Rolle im Plan, aber den internen Termin darf sie nicht sehen → „Belegt“
    expect(finde(await lies(ids.anna), intern.id)).toMatchObject({ title: null, requester_name: null });
    expect(finde(await lies(ids.anna), offen.id)).toMatchObject({ title: 'Für alle', is_public: true });
    // Verwaltung und Leitung sehen alles
    expect(finde(await lies(ids.paul), intern.id)).toMatchObject({ title: 'Nur Vorstand', is_public: false });
    expect(finde(await lies(ids.olga), intern.id)).toMatchObject({ title: 'Nur Vorstand' });
    // Vorstand (Clara) darf den Termin sehen
    expect(finde(await lies(ids.clara), intern.id)).toMatchObject({ title: 'Nur Vorstand' });

    // Umbenennen und Öffentlichkeit wirken sofort (kein Kopieren)
    ok(await f.api('patch', e(`/${intern.id}`), ids.olga, { title: 'Umbenannt', allowed_roles: ['public', 'member', 'committee', 'admin'] }));
    expect(finde(await lies(ids.anna), intern.id)).toMatchObject({ title: 'Umbenannt', is_public: true });
  });

  it('lässt verknüpfte Buchungen im Plan nicht verschieben oder umbenennen, Entscheiden und Löschen geht', async () => {
    const t = ok(await f.api('post', e(), ids.clara, termin(100, { title: 'Verknüpft' })));
    const b = (await buchung(t.id))[0];
    const url = `/api/v1/orgs/${ids.alpha}/bookings/${b.id}`;
    for (const daten of [{ title: 'Neu' }, { start_at: new Date(Date.now() + 100 * 86_400_000).toISOString() }, { is_public: true }]) {
      const antwort = await f.api('patch', url, ids.olga, daten);
      expect(antwort.status, JSON.stringify(daten)).toBe(409);
      expect(antwort.body).toMatchObject({ code: 'booking_linked' });
    }
    ok(await f.api('patch', url, ids.olga, { note: 'Notiz geht' }));
    // Ablehnen: der Termin bleibt bestehen, die Person bekommt eine Mail
    const vorher = await mails('booking_decision');
    const abgelehnt = ok(await f.api('post', `${url}/decline`, ids.paul, { reason: 'Saal gesperrt' }));
    expect(abgelehnt.status).toBe('declined');
    expect((await f.api('get', e(`/${t.id}`), ids.clara)).status).toBe(200);
    const neu = (await mails('booking_decision')).filter((m) => !vorher.some((v) => v.id === m.id));
    expect(neu.map((m) => m.recipient)).toEqual(['clara-10@example.org']);
    // Termin zeigt „abgelehnt“
    expect((await f.api('get', e(`/${t.id}`), ids.clara)).body.booking.status).toBe('declined');
    // ein neuer Plan für denselben Termin ist wieder möglich (abgelehnt ist keine wirksame Buchung)
    ok(await f.api('patch', e(`/${t.id}`), ids.olga, { booking_calendar_id: saal }));
    // Löschen im Plan lässt den Termin bestehen
    const aktiv = (await buchung(t.id)).find((x) => x.status === 'approved');
    expect((await f.api('delete', `/api/v1/orgs/${ids.alpha}/bookings/${aktiv.id}`, ids.paul)).status).toBe(204);
    expect((await f.api('get', e(`/${t.id}`), ids.clara)).status).toBe(200);
  });

  it('zeigt die Reservierung nie auf der öffentlichen Terminseite', async () => {
    const t = ok(await f.api('post', e(), ids.olga, termin(110, { title: 'Öffentlich mit Ort' })));
    const antwort = await f.api('get', `/api/v1/public/events/${t.id}`);
    expect(antwort.status).toBe(200);
    expect(antwort.body.booking).toBeUndefined();
  });
});
