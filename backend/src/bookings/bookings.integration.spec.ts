import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { erstelleFixture, type Fixture } from '../../test/fixture';

import { berlinUhr, berlinZeitpunkt } from './zeit';

/** ISO-Zeitraum am Berliner Tag „heute + tage“ von `von` bis `bis` Uhr (bis 24 = Mitternacht). */
function slot(tage: number, von: number, bis: number, bisTage = tage): { start_at: string; end_at: string } {
  const a = berlinUhr(new Date(Date.now() + tage * 86_400_000));
  const b = berlinUhr(new Date(Date.now() + bisTage * 86_400_000));
  return { start_at: berlinZeitpunkt(a.jahr, a.monat, a.tag, von).toISOString(), end_at: berlinZeitpunkt(b.jahr, b.monat, b.tag, bis).toISOString() };
}
const datum = (tage: number): string => {
  const u = berlinUhr(new Date(Date.now() + tage * 86_400_000));
  return `${u.jahr}-${String(u.monat).padStart(2, '0')}-${String(u.tag).padStart(2, '0')}`;
};

/**
 * Belegungspläne: Rollen, Anfragen, Entscheidungen, Serien und Sichtbarkeit gegen echtes PostgreSQL.
 * Alpha: Olga (Admin), Clara (Vorstand), Anna (Mitglied), Paul (Mitglied). Beta: Bernd (Admin). Dora: ohne Mitgliedschaft.
 * Im Saal: Anna = Buchende, Paul = Verwaltung, Clara ohne Rolle, Olga = Leitung (Admin).
 */
describe('Belegung (echtes PostgreSQL)', () => {
  let f: Fixture;
  let ids: Fixture['ids'];
  let saal: string;
  /** Zweiter Plan für die Entscheidungstests: Paul = Verwaltung, Anna und Clara = Buchende. */
  let rennen: string;
  const p = (org: string, rest = '') => `/api/v1/orgs/${org}/booking-calendars${rest}`;
  const b = (org: string, rest = '') => `/api/v1/orgs/${org}/bookings${rest}`;

  async function plan(konto: string, extra: object = {}, org = ids.alpha): Promise<{ id: string }> {
    const antwort = await f.api('post', p(org), konto, { name: 'Plan', kind: 'place', ...extra });
    expect(antwort.status, JSON.stringify(antwort.body)).toBe(201);
    return antwort.body;
  }
  async function anfrage(konto: string, zeit: object, titel = 'Treffen', plId = saal, extra: object = {}) {
    return f.api('post', p(ids.alpha, `/${plId}/bookings`), konto, { title: titel, ...zeit, ...extra });
  }
  async function ok(antwort: { status: number; body: any }) {
    expect(antwort.status, JSON.stringify(antwort.body)).toBeLessThan(300);
    return antwort.body;
  }
  type MailZeile = { id: string; recipient: string; subject: string; text_body: string };
  const mails = async (kind: string): Promise<MailZeile[]> => (await f.admin.query('SELECT id, recipient, subject, text_body FROM mail_outbox WHERE kind = $1', [kind])).rows;
  /** Mails, die seit `vorher` dazugekommen sind (die IDs sind UUIDs, die Reihenfolge sagt nichts). */
  const neueMails = async (kind: string, vorher: MailZeile[]): Promise<MailZeile[]> => {
    const alt = new Set(vorher.map((m) => m.id));
    return (await mails(kind)).filter((m) => !alt.has(m.id));
  };

  beforeAll(async () => {
    f = await erstelleFixture('pulsedeck_bookings_test');
    ids = f.ids;
    saal = (await plan(ids.olga, { name: 'Bürgerhaus Saal', address: 'Marktstraße 12', state: 'NW' })).id;
    await ok(await f.api('put', p(ids.alpha, `/${saal}/members/${ids.paulMitglied}`), ids.olga, { role: 'manager' }));
    await ok(await f.api('put', p(ids.alpha, `/${saal}/members/${ids.annaMitglied}`), ids.olga, { role: 'requester' }));
    rennen = (await plan(ids.olga, { name: 'Gruppenraum' })).id;
    for (const [mitglied, rolle] of [[ids.paulMitglied, 'manager'], [ids.annaMitglied, 'requester'], [ids.claraAlpha, 'requester']]) {
      await ok(await f.api('put', p(ids.alpha, `/${rennen}/members/${mitglied}`), ids.olga, { role: rolle }));
    }
  });
  afterAll(async () => {
    await f.schliessen();
  });

  // ── Pläne und Rollen ────────────────────────────────────────────────────────

  it('lässt nur Administratoren Pläne anlegen und löschen; wer anlegt, ist Leitung', async () => {
    for (const konto of [ids.clara, ids.anna, ids.paul]) {
      expect((await f.api('post', p(ids.alpha), konto, { name: 'X', kind: 'place' })).status).toBe(403);
    }
    expect((await f.api('post', p(ids.alpha), ids.dora, { name: 'X', kind: 'place' })).status).toBe(403); // keine Mitgliedschaft
    expect((await f.api('post', p(ids.alpha), null, { name: 'X', kind: 'place' })).status).toBe(401);
    const neu = await plan(ids.olga, { name: 'Lastenrad', kind: 'item' });
    const liste = (await f.api('get', p(ids.alpha), ids.olga)).body;
    expect(liste.find((x: any) => x.id === neu.id)).toMatchObject({ kind: 'item', my_role: 'lead', window_start: 8, window_end: 22, public_view: 'none' });
    expect((await f.api('delete', p(ids.alpha, `/${neu.id}`), ids.paul)).status).toBe(403);
    expect((await f.api('delete', p(ids.alpha, `/${neu.id}`), ids.olga)).status).toBe(204);
    expect((await f.api('get', p(ids.alpha, `/${neu.id}`), ids.olga)).status).toBe(404);
  });

  it('prüft die Eingabe der Pläne', async () => {
    for (const falsch of [
      { name: '' }, { kind: 'raum' }, { state: 'XX' }, { window_start: 22, window_end: 8 }, { window_end: 25 }, { public_view: 'day' },
      { organization_id: ids.beta }, { id: ids.beta },
    ]) {
      expect((await f.api('post', p(ids.alpha), ids.olga, { name: 'X', kind: 'place', ...falsch })).status, JSON.stringify(falsch)).toBe(400);
    }
  });

  it('zeigt jedem Mitglied alle Pläne lesend mit der eigenen Rolle, nie die einer fremden Organisation', async () => {
    const olga = (await f.api('get', p(ids.alpha), ids.olga)).body.find((x: any) => x.id === saal);
    const paul = (await f.api('get', p(ids.alpha), ids.paul)).body.find((x: any) => x.id === saal);
    const anna = (await f.api('get', p(ids.alpha), ids.anna)).body.find((x: any) => x.id === saal);
    const clara = (await f.api('get', p(ids.alpha), ids.clara)).body.find((x: any) => x.id === saal);
    expect([olga.my_role, paul.my_role, anna.my_role, clara.my_role]).toEqual(['lead', 'manager', 'requester', null]);
    expect((await f.api('get', p(ids.beta), ids.bernd)).body.find((x: any) => x.id === saal)).toBeUndefined();
    expect((await f.api('get', p(ids.alpha), ids.bernd)).status).toBe(403); // Beta-Admin hat in Alpha keine Mitgliedschaft
    expect((await f.api('get', p(ids.beta, `/${saal}`), ids.bernd)).status).toBe(404); // Plan aus Alpha über Beta ist unbekannt
  });

  it('vergibt Rollen im Plan nur durch die Leitung und nur an Mitglieder derselben Organisation', async () => {
    for (const konto of [ids.paul, ids.anna, ids.clara]) {
      expect((await f.api('put', p(ids.alpha, `/${saal}/members/${ids.claraAlpha}`), konto, { role: 'requester' })).status).toBe(403);
      expect((await f.api('get', p(ids.alpha, `/${saal}/members`), konto)).status).toBe(403);
      expect((await f.api('delete', p(ids.alpha, `/${saal}/members/${ids.annaMitglied}`), konto)).status).toBe(403);
    }
    expect((await f.api('put', p(ids.alpha, `/${saal}/members/${ids.berndMitglied}`), ids.olga, { role: 'lead' })).status).toBe(400); // Mitglied von Beta
    expect((await f.api('put', p(ids.alpha, `/${saal}/members/${ids.claraAlpha}`), ids.olga, { role: 'superuser' })).status).toBe(400);
    const rollen = (await f.api('get', p(ids.alpha, `/${saal}/members`), ids.olga)).body;
    expect(rollen.map((r: any) => [r.name, r.role]).sort()).toEqual([['Anna', 'requester'], ['Olga', 'lead'], ['Paul', 'manager']]);
  });

  it('lässt Einstellungen nur die Leitung ändern und schützt bestehende Belegungen beim Zeitfenster', async () => {
    const eigener = (await plan(ids.olga, { name: 'Einstellungen' })).id;
    await ok(await f.api('put', p(ids.alpha, `/${eigener}/members/${ids.paulMitglied}`), ids.olga, { role: 'manager' }));
    expect((await f.api('patch', p(ids.alpha, `/${eigener}`), ids.paul, { name: 'Neu' })).status).toBe(403); // Verwaltung ist nicht Leitung
    expect((await f.api('patch', p(ids.alpha, `/${eigener}`), ids.anna, { name: 'Neu' })).status).toBe(403);
    await ok(await f.api('post', p(ids.alpha, `/${eigener}/bookings`), ids.olga, { title: 'Abend', ...slot(30, 19, 21) }));
    expect((await f.api('patch', p(ids.alpha, `/${eigener}`), ids.olga, { window_end: 20 })).status).toBe(409);
    expect((await f.api('patch', p(ids.alpha, `/${eigener}`), ids.olga, { window_start: 20, window_end: 10 })).status).toBe(400);
    const geaendert = await ok(await f.api('patch', p(ids.alpha, `/${eigener}`), ids.olga, { name: 'Umbenannt', window_start: 6, all_members_can_request: true, public_view: 'year', state: 'BY' }));
    expect(geaendert).toMatchObject({ name: 'Umbenannt', window_start: 6, all_members_can_request: true, public_view: 'year', state: 'BY' });
    const audit = await f.admin.query("SELECT performed_by FROM audit_logs WHERE table_name = 'booking_calendars' AND record_id = $1 AND operation = 'UPDATE'", [eigener]);
    expect(audit.rows).toEqual([{ performed_by: ids.olga }]);
  });

  // ── Anfragen ────────────────────────────────────────────────────────────────

  it('lässt nur Personen mit Rolle anfragen (oder alle, wenn der Plan es erlaubt); Verwaltung und Leitung tragen direkt ein', async () => {
    expect((await anfrage(ids.clara, slot(5, 10, 12))).status).toBe(403); // Mitglied ohne Rolle
    expect((await anfrage(null as unknown as string, slot(5, 10, 12))).status).toBe(401);
    expect((await anfrage(ids.dora, slot(5, 10, 12))).status).toBe(403); // keine Mitgliedschaft
    const angefragt = await ok(await anfrage(ids.anna, slot(5, 10, 12), 'Kreisversammlung'));
    expect(angefragt).toMatchObject({ status: 'requested', title: 'Kreisversammlung', is_mine: true, requester_name: 'Anna' });
    const direkt = await ok(await anfrage(ids.paul, slot(6, 10, 12), 'Direkt'));
    expect(direkt.status).toBe('approved');
    expect((await anfrage(ids.olga, slot(7, 10, 12), 'Leitung')).body.status).toBe('approved');

    const offen = (await plan(ids.olga, { name: 'Offen', all_members_can_request: true })).id;
    expect((await anfrage(ids.clara, slot(5, 10, 12), 'Frei für alle', offen)).body.status).toBe('requested');
  });

  it('prüft Zeiträume: volle Stunden, Ende nach Beginn, höchstens 14 Tage, Zeitfenster, Zukunft für Buchende', async () => {
    const a = berlinUhr(new Date(Date.now() + 9 * 86_400_000));
    const halb = { start_at: berlinZeitpunkt(a.jahr, a.monat, a.tag, 10).toISOString().replace(':00:00', ':30:00'), end_at: slot(9, 12, 13).end_at };
    for (const [name, zeit] of Object.entries({
      halbeStunde: halb,
      endeVorBeginn: slot(9, 14, 12),
      zuLang: slot(9, 10, 12, 25),
      vorFenster: slot(9, 6, 9),
      nachFenster: slot(9, 20, 23),
      vergangenheit: slot(-3, 10, 12),
      keinDatum: { start_at: 'morgen', end_at: 'übermorgen' },
    })) {
      expect((await anfrage(ids.anna, zeit as object, name)).status, name).toBe(400);
    }
    // Verwaltung und Leitung dürfen Vergangenes eintragen
    expect((await anfrage(ids.paul, slot(-3, 10, 12), 'Nachtrag')).status).toBe(201);
    // genau am Fensterrand ist erlaubt (8 bis 22 Uhr)
    expect((await anfrage(ids.anna, slot(9, 8, 22), 'Ganztag')).status).toBe(201);
  });

  it('erlaubt überschneidende Anfragen untereinander, nicht aber mit angenommenen Buchungen (409 booking_conflict)', async () => {
    const eins = await ok(await anfrage(ids.anna, slot(40, 10, 14), 'Plan A'));
    const zwei = await ok(await anfrage(ids.paul, slot(40, 12, 16), 'Plan B', saal)); // Verwaltung: gilt sofort
    expect(zwei.status).toBe('approved');
    expect(eins.status).toBe('requested'); // überschneidet sich zwar, war aber vorher eine offene Anfrage
    const konflikt = await anfrage(ids.anna, slot(40, 15, 17), 'Zu spät');
    expect(konflikt.status).toBe(409);
    expect(konflikt.body).toMatchObject({ code: 'booking_conflict' });
    expect((await anfrage(ids.olga, slot(40, 11, 13), 'Direkt auf belegt')).status).toBe(409);
    // direkt anschließend ist frei (Ende exklusiv)
    expect((await anfrage(ids.olga, slot(40, 16, 18), 'Anschluss')).status).toBe(201);
  });

  it('belegt bei mehrtägigen Buchungen auch die Nächte dazwischen', async () => {
    await ok(await anfrage(ids.olga, slot(60, 18, 12, 62), 'Markt Aufbau')); // 18 Uhr bis übermorgen 12 Uhr
    expect((await anfrage(ids.olga, slot(61, 9, 11), 'Mittendrin')).status).toBe(409);
    expect((await anfrage(ids.olga, slot(62, 11, 13), 'Rand')).status).toBe(409);
    expect((await anfrage(ids.olga, slot(62, 12, 14), 'Danach')).status).toBe(201);
  });

  // ── Entscheidungen ──────────────────────────────────────────────────────────

  it('lässt nur Verwaltung und Leitung entscheiden; Buchende, Mitglieder und Fremde nicht', async () => {
    const x = await ok(await anfrage(ids.anna, slot(70, 10, 12), 'Entscheidungsfall'));
    for (const konto of [ids.anna, ids.clara, ids.dora]) {
      expect((await f.api('post', b(ids.alpha, `/${x.id}/approve`), konto)).status, `approve ${konto}`).toBe(403);
      expect((await f.api('post', b(ids.alpha, `/${x.id}/decline`), konto, { reason: 'nein' })).status).toBe(403);
      expect((await f.api('delete', b(ids.alpha, `/${x.id}`), konto)).status).toBe(403);
      expect((await f.api('patch', b(ids.alpha, `/${x.id}`), konto, { title: 'Umbenannt' })).status).toBe(403);
    }
    expect((await f.api('post', b(ids.alpha, `/${x.id}/approve`), ids.bernd)).status).toBe(403); // Admin einer anderen Organisation
    expect((await f.api('post', b(ids.beta, `/${x.id}/approve`), ids.bernd)).status).toBe(404); // dieselbe ID über Beta: unbekannt
    expect((await f.api('post', b(ids.alpha, `/${x.id}/approve`), null)).status).toBe(401);
    expect((await f.api('post', b(ids.alpha, `/${x.id}/approve`), ids.paul)).body).toMatchObject({ status: 'approved' });
    expect((await f.api('post', b(ids.alpha, `/${x.id}/approve`), ids.paul)).status).toBe(409); // nicht mehr offen
  });

  it('lehnt beim Annehmen überschneidende offene Anfragen in derselben Transaktion ab und schreibt Mails', async () => {
    const a = await ok(await anfrage(ids.anna, slot(80, 10, 14), 'Gewinner', rennen));
    const c = await ok(await anfrage(ids.clara, slot(80, 12, 16), 'Verlierer', rennen));
    const unbeteiligt = await ok(await anfrage(ids.anna, slot(80, 17, 19), 'Unbeteiligt', rennen));
    const vorher = await mails('booking_decision');
    expect((await f.api('post', b(ids.alpha, `/${a.id}/approve`), ids.paul)).body.status).toBe('approved');
    const rows = (await f.admin.query('SELECT id, status, decision_reason, decided_by FROM bookings WHERE id = ANY($1)', [[a.id, c.id, unbeteiligt.id]])).rows;
    const nach = (id: string) => rows.find((r) => r.id === id);
    expect(nach(c.id)).toMatchObject({ status: 'declined', decision_reason: 'Zeitraum anderweitig vergeben', decided_by: ids.paulMitglied });
    expect(nach(unbeteiligt.id)).toMatchObject({ status: 'requested' });
    const neu = await neueMails('booking_decision', vorher);
    expect(neu.map((m) => m.recipient).sort()).toEqual(['anna-10@example.org', 'clara-10@example.org']);
    expect(neu.find((m) => m.recipient === 'clara-10@example.org')?.text_body).toContain('anderweitig vergeben');
  });

  it('lässt von zwei gleichzeitigen Annahmen überlappender Anfragen genau eine gewinnen', async () => {
    const eins = await ok(await anfrage(ids.anna, slot(90, 10, 14), 'Rennen 1', rennen));
    const zwei = await ok(await anfrage(ids.clara, slot(90, 12, 16), 'Rennen 2', rennen));
    const [r1, r2] = await Promise.all([
      f.api('post', b(ids.alpha, `/${eins.id}/approve`), ids.paul),
      f.api('post', b(ids.alpha, `/${zwei.id}/approve`), ids.olga),
    ]);
    expect([r1.status, r2.status].sort()).toEqual([200, 409]);
    const verlierer = r1.status === 409 ? r1 : r2;
    expect(['booking_conflict', 'booking_not_open']).toContain(verlierer.body.code);
    const { rows } = await f.admin.query("SELECT count(*)::int AS n FROM bookings WHERE id = ANY($1) AND status = 'approved'", [[eins.id, zwei.id]]);
    expect(rows[0].n).toBe(1);
  });

  it('erzwingt die Kernregel in der Datenbank selbst (Exclusion Constraint), auch an der API vorbei', async () => {
    const t = slot(100, 10, 12);
    await ok(await anfrage(ids.olga, t, 'Erste'));
    await expect(
      f.admin.query(
        `INSERT INTO bookings (organization_id, calendar_id, member_id, title, starts_at, ends_at, status) VALUES ($1, $2, $3, 'Zweite', $4, $5, 'approved')`,
        [ids.alpha, saal, ids.olgaMitglied, slot(100, 11, 13).start_at, slot(100, 11, 13).end_at]
      )
    ).rejects.toMatchObject({ code: '23P01' });
    // als Anfrage (nicht angenommen) ist dieselbe Überschneidung erlaubt
    await f.admin.query(
      `INSERT INTO bookings (organization_id, calendar_id, member_id, title, starts_at, ends_at, status) VALUES ($1, $2, $3, 'Anfrage', $4, $5, 'requested')`,
      [ids.alpha, saal, ids.olgaMitglied, slot(100, 11, 13).start_at, slot(100, 11, 13).end_at]
    );
  });

  it('lehnt mit Begründung ab, informiert die Person und zeigt sie nur ihr, Verwaltung und Leitung', async () => {
    const x = await ok(await anfrage(ids.anna, slot(110, 10, 12), 'Abzulehnen'));
    const vorher = await mails('booking_decision');
    const abgelehnt = await ok(await f.api('post', b(ids.alpha, `/${x.id}/decline`), ids.paul, { reason: 'Saal wird renoviert' }));
    expect(abgelehnt).toMatchObject({ status: 'declined', decision_reason: 'Saal wird renoviert' });
    const mail = await neueMails('booking_decision', vorher);
    expect(mail).toHaveLength(1);
    expect(mail[0].text_body).toContain('Saal wird renoviert');
    const liste = (konto: string) => f.api('get', p(ids.alpha, `/${saal}/bookings?from=${datum(105)}&to=${datum(115)}`), konto).then((r) => r.body);
    expect((await liste(ids.anna)).map((z: any) => z.id)).toContain(x.id);
    expect((await liste(ids.paul)).map((z: any) => z.id)).toContain(x.id);
    expect((await liste(ids.olga)).map((z: any) => z.id)).toContain(x.id);
    expect((await liste(ids.clara)).map((z: any) => z.id)).not.toContain(x.id); // Mitglied ohne Bezug sieht abgelehnte nicht
    expect((await f.api('post', b(ids.alpha, `/${x.id}/decline`), ids.paul, {})).status).toBe(409);
  });

  it('lässt Buchende die eigene Anfrage zurückziehen, fremde nicht', async () => {
    const x = await ok(await anfrage(ids.anna, slot(120, 10, 12), 'Zurückzuziehen'));
    expect((await f.api('post', b(ids.alpha, `/${x.id}/cancel`), ids.clara)).status).toBe(403); // fremde Buchung
    expect((await f.api('post', b(ids.alpha, `/${x.id}/cancel`), ids.dora)).status).toBe(403);
    expect((await f.api('post', b(ids.alpha, `/${x.id}/cancel`), ids.anna)).body.status).toBe('cancelled');
    expect((await f.api('post', b(ids.alpha, `/${x.id}/cancel`), ids.anna)).status).toBe(409);
    // storniert gibt den Zeitraum frei
    expect((await anfrage(ids.olga, slot(120, 10, 12), 'Frei')).status).toBe(201);
  });

  it('lässt Verwaltung und Leitung löschen, verschieben und umbenennen; Verschieben auf Belegtes ist 409', async () => {
    const x = await ok(await anfrage(ids.olga, slot(130, 10, 12), 'Verschiebbar'));
    await ok(await anfrage(ids.olga, slot(130, 14, 16), 'Hindernis'));
    expect((await f.api('patch', b(ids.alpha, `/${x.id}`), ids.paul, { start_at: slot(130, 15, 17).start_at, end_at: slot(130, 15, 17).end_at })).status).toBe(409);
    const verschoben = await ok(await f.api('patch', b(ids.alpha, `/${x.id}`), ids.paul, { ...slot(130, 12, 14), title: 'Verschoben', is_public: true }));
    expect(verschoben).toMatchObject({ title: 'Verschoben', is_public: true, status: 'approved' });
    expect(new Date(verschoben.start_at).toISOString()).toBe(slot(130, 12, 14).start_at);
    expect((await f.api('patch', b(ids.alpha, `/${x.id}`), ids.paul, { start_at: slot(130, 12, 14).start_at.replace(':00:00', ':15:00') })).status).toBe(400);
    expect((await f.api('delete', b(ids.alpha, `/${x.id}`), ids.paul)).status).toBe(204);
    expect((await f.api('delete', b(ids.alpha, `/${x.id}`), ids.paul)).status).toBe(404);
  });

  // ── Sichtbarkeit ────────────────────────────────────────────────────────────

  it('maskiert Titel, Notiz und Person für Mitglieder ohne Rolle; Rolleninhaber und Beteiligte sehen sie', async () => {
    const zeit = slot(140, 10, 12);
    const privat = await ok(await anfrage(ids.paul, zeit, 'Vertraulich', saal, { note: 'Geheime Notiz' }));
    const oeffentlich = await ok(await anfrage(ids.paul, slot(141, 10, 12), 'Offen für alle', saal, { is_public: true }));
    const lies = async (konto: string) => (await f.api('get', p(ids.alpha, `/${saal}/bookings?from=${datum(139)}&to=${datum(142)}`), konto)).body;
    const ausClara = await lies(ids.clara); // keine Rolle
    const sehen = (liste: any[], id: string) => liste.find((z) => z.id === id);
    // Clara sieht, dass belegt ist, aber weder Titel noch Notiz noch Person
    expect(sehen(ausClara, privat.id)).toMatchObject({ title: null, note: null, requester_name: null, status: 'approved' });
    // angenommen und öffentlich: für alle Mitglieder sichtbar
    expect(sehen(ausClara, oeffentlich.id)).toMatchObject({ title: 'Offen für alle', is_public: true });
    // Rolleninhaber (Buchende) sehen Titel, Verwaltung sowieso
    expect(sehen(await lies(ids.anna), privat.id)).toMatchObject({ title: 'Vertraulich', note: 'Geheime Notiz', requester_name: 'Paul' });
    expect(sehen(await lies(ids.olga), privat.id)).toMatchObject({ title: 'Vertraulich' });
    expect((await f.api('get', p(ids.alpha, `/${saal}/bookings?from=${datum(139)}&to=${datum(142)}`), ids.bernd)).status).toBe(403);
    expect((await f.api('get', p(ids.alpha, `/${saal}/bookings?from=${datum(139)}&to=${datum(142)}`), null)).status).toBe(401);
    expect((await f.api('get', p(ids.alpha, `/${saal}/bookings?from=kaputt&to=${datum(142)}`), ids.olga)).status).toBe(400);
  });

  it('meldet die Verfügbarkeit für den Termin-Dialog: frei, Überschneidung mit Anfragen, belegt', async () => {
    await ok(await anfrage(ids.anna, slot(150, 10, 14), 'Planung'));
    await ok(await anfrage(ids.olga, slot(150, 16, 18), 'Fest'));
    const status = async (zeit: { start_at: string; end_at: string }) =>
      (await f.api('get', p(ids.alpha, `/${saal}/availability?start_at=${encodeURIComponent(zeit.start_at)}&end_at=${encodeURIComponent(zeit.end_at)}`), ids.clara)).body;
    expect((await status(slot(150, 8, 10))).status).toBe('free');
    const ueberschneidung = await status(slot(150, 12, 15));
    expect(ueberschneidung.status).toBe('overlap');
    expect(ueberschneidung.conflicts[0].title).toBeNull(); // Clara hat keine Rolle: „Belegt“
    expect((await status(slot(150, 17, 19))).status).toBe('booked');
  });

  it('zählt offene Anfragen für das Badge nur in Plänen, in denen die Person entscheiden darf', async () => {
    const zaehle = async (konto: string, org = ids.alpha) => (await f.api('get', p(org, '/open-requests'), konto)).body.count;
    const olga = await zaehle(ids.olga);
    const { rows } = await f.admin.query("SELECT count(*)::int AS n FROM bookings WHERE organization_id = $1 AND status = 'requested'", [ids.alpha]);
    expect(olga).toBe(rows[0].n);
    expect(olga).toBeGreaterThan(0);
    expect(await zaehle(ids.paul)).toBeGreaterThan(0); // Verwaltung im Saal
    expect(await zaehle(ids.anna)).toBe(0); // nur Buchende
    expect(await zaehle(ids.bernd, ids.beta)).toBe(0); // Beta hat keine eigenen Anfragen
  });

  // ── Serien ──────────────────────────────────────────────────────────────────

  const serie = (extra: object = {}) => ({
    title: 'Frauencafé', is_public: true, weekdays: [4], every_n_weeks: 1, hour_from: 15, hour_to: 17,
    valid_from: '2026-12-18', valid_to: '2027-01-15', skip_holidays: true, ...extra,
  });
  const serienPlan = async () => (await plan(ids.olga, { name: `Serien ${Math.random()}`, state: 'NW' })).id;

  it('lässt Serien nur die Leitung anlegen und zeigt vorher eine Vorschau mit Feiertagen und Belegtem', async () => {
    const sp = await serienPlan();
    await ok(await f.api('put', p(ids.alpha, `/${sp}/members/${ids.paulMitglied}`), ids.olga, { role: 'manager' }));
    await ok(await f.api('put', p(ids.alpha, `/${sp}/members/${ids.annaMitglied}`), ids.olga, { role: 'requester' }));
    for (const konto of [ids.paul, ids.anna, ids.clara]) {
      expect((await f.api('post', p(ids.alpha, `/${sp}/series/preview`), konto, serie())).status, `preview ${konto}`).toBe(403);
      expect((await f.api('post', p(ids.alpha, `/${sp}/series`), konto, serie())).status).toBe(403);
    }
    // 8. Januar 2027 (Freitag) ist belegt, außerdem eine offene Anfrage am 15.1.
    await ok(await f.api('post', p(ids.alpha, `/${sp}/bookings`), ids.olga, { title: 'Belegt', start_at: berlinZeitpunkt(2027, 1, 8, 16).toISOString(), end_at: berlinZeitpunkt(2027, 1, 8, 18).toISOString() }));
    // Offene Anfrage am 15.1., die sich mit dem Serientermin überschneidet (Anna ist Buchende im Plan; in der Zukunft)
    await ok(await f.api('post', p(ids.alpha, `/${sp}/bookings`), ids.anna, { title: 'Offene Anfrage', start_at: berlinZeitpunkt(2027, 1, 15, 14).toISOString(), end_at: berlinZeitpunkt(2027, 1, 15, 16).toISOString() }));
    const vorschau = (await f.api('post', p(ids.alpha, `/${sp}/series/preview`), ids.olga, serie())).body;
    expect(vorschau.skipped_holidays).toEqual(['2026-12-25', '2027-01-01']);
    expect(vorschau.skipped_booked).toEqual(['2027-01-08']);
    expect(vorschau.dates).toEqual(['2026-12-18', '2027-01-15']);
    expect(vorschau.declined_requests.map((x: any) => x.title)).toEqual(['Offene Anfrage']);
    // Vorschau schreibt nichts
    expect((await f.admin.query('SELECT count(*)::int AS n FROM booking_series WHERE calendar_id = $1', [sp])).rows[0].n).toBe(0);
    // mit Feiertagen: 25.12. und 1.1. gehören dazu
    const mitFeiertagen = (await f.api('post', p(ids.alpha, `/${sp}/series/preview`), ids.olga, serie({ skip_holidays: false }))).body;
    expect(mitFeiertagen.dates).toEqual(['2026-12-18', '2026-12-25', '2027-01-01', '2027-01-15']);
  });

  it('legt die Serie in einer Transaktion an: übersprungen, abgelehnt, Zeiten über die Zeitumstellung', async () => {
    const sp = await serienPlan();
    await ok(await f.api('post', p(ids.alpha, `/${sp}/bookings`), ids.olga, { title: 'Belegt', start_at: berlinZeitpunkt(2027, 1, 8, 16).toISOString(), end_at: berlinZeitpunkt(2027, 1, 8, 18).toISOString() }));
    const ergebnis = await ok(await f.api('post', p(ids.alpha, `/${sp}/series`), ids.olga, serie()));
    expect(ergebnis).toMatchObject({ created: 2, skipped_booked: ['2027-01-08'], skipped_holidays: ['2026-12-25', '2027-01-01'], declined_requests: 0 });
    const { rows } = await f.admin.query("SELECT starts_at, status, title, is_public FROM bookings WHERE series_id = $1 ORDER BY starts_at", [ergebnis.series_id]);
    expect(rows.map((r) => r.status)).toEqual(['approved', 'approved']);
    expect(rows[0]).toMatchObject({ title: 'Frauencafé', is_public: true });
    expect(rows[0].starts_at.toISOString()).toBe('2026-12-18T14:00:00.000Z'); // 15 Uhr Winterzeit

    // Zeitumstellung: sonntags 9 bis 11 Uhr von Ende März bis Anfang April 2026
    const sp2 = await serienPlan();
    const umstellung = await ok(await f.api('post', p(ids.alpha, `/${sp2}/series`), ids.olga, serie({ weekdays: [6], hour_from: 9, hour_to: 11, valid_from: '2026-03-22', valid_to: '2026-04-05', skip_holidays: false })));
    const u = await f.admin.query('SELECT starts_at FROM bookings WHERE series_id = $1 ORDER BY starts_at', [umstellung.series_id]);
    expect(u.rows.map((r) => r.starts_at.toISOString())).toEqual(['2026-03-22T08:00:00.000Z', '2026-03-29T07:00:00.000Z', '2026-04-05T07:00:00.000Z']); // 9 Uhr MEZ, dann MESZ
    // und im Oktober
    const sp3 = await serienPlan();
    const oktober = await ok(await f.api('post', p(ids.alpha, `/${sp3}/series`), ids.olga, serie({ weekdays: [6], hour_from: 9, hour_to: 11, valid_from: '2026-10-18', valid_to: '2026-11-01', skip_holidays: false })));
    const o = await f.admin.query('SELECT starts_at FROM bookings WHERE series_id = $1 ORDER BY starts_at', [oktober.series_id]);
    expect(o.rows.map((r) => r.starts_at.toISOString())).toEqual(['2026-10-18T07:00:00.000Z', '2026-10-25T08:00:00.000Z', '2026-11-01T08:00:00.000Z']);
  });

  it('lehnt offene Anfragen im Zeitraum der Serie ab und schickt Mails', async () => {
    const sp = await serienPlan();
    await ok(await f.api('put', p(ids.alpha, `/${sp}/members/${ids.annaMitglied}`), ids.olga, { role: 'requester' }));
    const offen = await ok(await f.api('post', p(ids.alpha, `/${sp}/bookings`), ids.anna, { title: 'Offene Anfrage', ...slot(200, 15, 17) }));
    const tag = datum(200);
    const wt = (new Date(`${tag}T12:00:00Z`).getUTCDay() + 6) % 7;
    const vorher = await mails('booking_decision');
    const ergebnis = await ok(await f.api('post', p(ids.alpha, `/${sp}/series`), ids.olga, serie({ weekdays: [wt], valid_from: tag, valid_to: tag, skip_holidays: false })));
    expect(ergebnis).toMatchObject({ created: 1, declined_requests: 1 });
    expect((await f.admin.query('SELECT status, decision_reason FROM bookings WHERE id = $1', [offen.id])).rows[0]).toEqual({ status: 'declined', decision_reason: 'Zeitraum anderweitig vergeben' });
    expect(await neueMails('booking_decision', vorher)).toHaveLength(1);
  });

  it('prüft die Serie: höchstens 12 Monate, Zeitfenster, Wochentage, leere Serie', async () => {
    const sp = await serienPlan();
    for (const [name, falsch] of Object.entries({
      zuLang: { valid_from: '2026-12-01', valid_to: '2027-12-02' },
      rueckwaerts: { valid_from: '2027-01-10', valid_to: '2027-01-01' },
      ausserhalbFenster: { hour_from: 5, hour_to: 9 },
      endeVorBeginn: { hour_from: 18, hour_to: 17 },
      keinWochentag: { weekdays: [] },
      sonntag7: { weekdays: [7] },
      doppelt: { weekdays: [1, 1] },
      rhythmus5: { every_n_weeks: 5 },
      fremdesFeld: { organization_id: ids.beta },
    })) {
      expect((await f.api('post', p(ids.alpha, `/${sp}/series`), ids.olga, serie(falsch))).status, name).toBe(400);
    }
    // genau 12 Monate sind erlaubt
    expect((await f.api('post', p(ids.alpha, `/${sp}/series/preview`), ids.olga, serie({ valid_from: '2026-12-01', valid_to: '2027-12-01' }))).status).toBe(200);
    // Serie, die nur aus Feiertagen besteht: kein Termin
    expect((await f.api('post', p(ids.alpha, `/${sp}/series`), ids.olga, serie({ weekdays: [4], valid_from: '2026-12-25', valid_to: '2026-12-25' }))).status).toBe(400);
  });

  it('benennt Serien um und beendet sie ab einem Datum; nur die Leitung', async () => {
    const sp = await serienPlan();
    await ok(await f.api('put', p(ids.alpha, `/${sp}/members/${ids.paulMitglied}`), ids.olga, { role: 'manager' }));
    const s = await ok(await f.api('post', p(ids.alpha, `/${sp}/series`), ids.olga, serie({ skip_holidays: false })));
    expect((await f.api('patch', `/api/v1/orgs/${ids.alpha}/booking-series/${s.series_id}`, ids.paul, { title: 'Neu' })).status).toBe(403);
    expect((await f.api('post', `/api/v1/orgs/${ids.alpha}/booking-series/${s.series_id}/end`, ids.paul, { from: '2027-01-01' })).status).toBe(403);
    expect((await f.api('patch', `/api/v1/orgs/${ids.beta}/booking-series/${s.series_id}`, ids.bernd, { title: 'Neu' })).status).toBe(404);
    await ok(await f.api('patch', `/api/v1/orgs/${ids.alpha}/booking-series/${s.series_id}`, ids.olga, { title: 'Neuer Name' }));
    expect((await f.admin.query('SELECT DISTINCT title FROM bookings WHERE series_id = $1', [s.series_id])).rows).toEqual([{ title: 'Neuer Name' }]);
    const ende = await ok(await f.api('post', `/api/v1/orgs/${ids.alpha}/booking-series/${s.series_id}/end`, ids.olga, { from: '2027-01-01' }));
    expect(ende.removed).toBe(3); // 1., 8. und 15. Januar
    expect((await f.admin.query('SELECT count(*)::int AS n FROM bookings WHERE series_id = $1', [s.series_id])).rows[0].n).toBe(2); // 18. und 25. Dezember bleiben
    expect((await f.admin.query("SELECT to_char(valid_to, 'YYYY-MM-DD') AS bis FROM booking_series WHERE id = $1", [s.series_id])).rows[0].bis).toBe('2026-12-31');
  });

  // ── Mail, Audit, Löschen ────────────────────────────────────────────────────

  it('schreibt bei neuen Anfragen Mails an Verwaltung und Leitung (nicht an die Person selbst) und zeichnet Entscheidungen auf', async () => {
    const vorher = await mails('booking_request');
    const x = await ok(await anfrage(ids.anna, slot(210, 10, 12), 'Mail-Test'));
    const neu = await neueMails('booking_request', vorher);
    expect(neu.map((m) => m.recipient).sort()).toEqual(['olga-10@example.org', 'paul-10@example.org']);
    expect(neu[0].subject).toContain('Mail-Test');
    await ok(await f.api('post', b(ids.alpha, `/${x.id}/approve`), ids.paul));
    const audit = await f.admin.query("SELECT operation, performed_by, organization_id FROM audit_logs WHERE table_name = 'bookings' AND record_id = $1", [x.id]);
    expect(audit.rows).toHaveLength(2);
    expect(audit.rows).toEqual(expect.arrayContaining([
      { operation: 'INSERT', performed_by: ids.anna, organization_id: ids.alpha },
      { operation: 'UPDATE', performed_by: ids.paul, organization_id: ids.alpha },
    ]));
  });

  it('löscht beim Plan alle Rollen, Serien und Buchungen mit; fremde Organisationen bleiben unberührt', async () => {
    const loeschPlan = (await plan(ids.olga, { name: 'Zum Löschen' })).id;
    await ok(await anfrage(ids.olga, slot(220, 10, 12), 'Weg', loeschPlan));
    const beta = await plan(ids.bernd, { name: 'Beta-Plan' }, ids.beta);
    expect((await f.api('delete', p(ids.alpha, `/${loeschPlan}`), ids.bernd)).status).toBe(403);
    expect((await f.api('delete', p(ids.beta, `/${loeschPlan}`), ids.bernd)).status).toBe(404);
    expect((await f.api('delete', p(ids.alpha, `/${loeschPlan}`), ids.olga)).status).toBe(204);
    expect((await f.admin.query('SELECT count(*)::int AS n FROM bookings WHERE calendar_id = $1', [loeschPlan])).rows[0].n).toBe(0);
    expect((await f.api('get', p(ids.beta, `/${beta.id}`), ids.bernd)).status).toBe(200);
  });
});
