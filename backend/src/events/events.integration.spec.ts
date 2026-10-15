import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { erstelleFixture, type Fixture } from '../../test/fixture';

const inTagen = (n: number): string => new Date(Date.now() + n * 86_400_000).toISOString().split('T')[0];

/**
 * Termine, Anmeldungen, Helferslots, Matching und Gastorganisationen gegen echtes PostgreSQL.
 * Alpha: Olga (Admin), Clara (Vorstand), Anna (Mitglied, in der AG Technik), Paul (Mitglied, Leiter der AG Leitung).
 */
describe('Termine (echtes PostgreSQL)', () => {
  let f: Fixture;
  let ids: Fixture['ids'];
  let technik: string;
  let leitung: string;
  let betaAg: string;
  const e = (org: string, rest = '') => `/api/v1/orgs/${org}/events${rest}`;
  const termin = (extra: object = {}) => ({ title: 'Treffen', date: inTagen(10), start_time: '19:00', location: 'Vereinsheim', ...extra });

  async function legeAn(konto: string, extra: object = {}, org = ids.alpha): Promise<string> {
    const antwort = await f.api('post', e(org), konto, termin(extra));
    expect(antwort.status, JSON.stringify(antwort.body)).toBe(201);
    return antwort.body.id;
  }

  beforeAll(async () => {
    f = await erstelleFixture('pulsedeck_events_test');
    ids = f.ids;
    const ag = (org: string, name: string) =>
      f.admin.query(
        "INSERT INTO working_groups (organization_id, name, description, lead, next_meeting, contact_type, contact_icon) VALUES ($1, $2, 'd', 'l', 'n', 'Email', 'pi-envelope') RETURNING id",
        [org, name]
      );
    technik = (await ag(ids.alpha, 'Technik')).rows[0].id;
    leitung = (await ag(ids.alpha, 'Leitung')).rows[0].id;
    betaAg = (await ag(ids.beta, 'Beta-AG')).rows[0].id;
    await f.admin.query("INSERT INTO ag_memberships (working_group_id, member_id, role) VALUES ($1, $2, 'member'), ($3, $4, 'lead')", [technik, ids.annaMitglied, leitung, ids.paulMitglied]);
  });
  afterAll(async () => {
    await f.schliessen();
  });
  beforeEach(() => {
    f.pgApp.dispatcher.dispatch.mockClear();
  });

  it('legt Termine nur mit Berechtigung an (Admin, Vorstand, AG-Leitung nur für die eigene AG)', async () => {
    expect((await f.api('post', e(ids.alpha), ids.olga, termin({ ag_name: 'Erfunden' }))).body).toMatchObject({ organization_id: ids.alpha, ag_name: null });
    expect((await f.api('post', e(ids.alpha), ids.clara, termin())).status).toBe(201);
    expect((await f.api('post', e(ids.alpha), ids.paul, termin({ working_group_id: leitung }))).body).toMatchObject({ ag_name: 'Leitung', working_group_id: leitung });

    expect((await f.api('post', e(ids.alpha), ids.anna, termin())).status).toBe(403); // Mitglied ohne events:create
    expect((await f.api('post', e(ids.alpha), ids.paul, termin())).status).toBe(403); // AG-Leiter darf keine allgemeinen Termine
    expect((await f.api('post', e(ids.alpha), ids.paul, termin({ working_group_id: technik }))).status).toBe(403); // fremde AG
    expect((await f.api('post', e(ids.alpha), ids.bernd, termin())).status).toBe(403); // keine Mitgliedschaft in Alpha
    expect((await f.api('post', e(ids.alpha), null, termin())).status).toBe(401);
  });

  it('prüft die Eingabe: Format, unbekannte Felder, fremde Arbeitsgruppe, Serie ohne Intervall', async () => {
    for (const falsch of [
      { date: '01.11.2026' }, { start_time: '7 Uhr' }, { allowed_roles: ['superuser'] }, { location_type: 'teams' },
      { organization_id: ids.beta }, { id: ids.beta }, { max_participants: 0 }, { is_recurring: true },
    ]) {
      expect((await f.api('post', e(ids.alpha), ids.olga, termin(falsch))).status, JSON.stringify(falsch)).toBe(400);
    }
    expect((await f.api('post', e(ids.alpha), ids.olga, termin({ working_group_id: betaAg }))).status).toBe(400);
    expect((await f.api('post', e(ids.alpha), ids.olga, { title: 'x' })).status).toBe(400);
  });

  it('erzeugt Serientermine in einem Schritt und zeichnet die Änderung auf', async () => {
    const antwort = await f.api('post', e(ids.alpha), ids.olga, termin({ date: '2027-03-01', is_recurring: true, recurrence_interval: 'monthly' }));
    expect(antwort.status).toBe(201);
    const { rows } = await f.admin.query('SELECT date FROM events WHERE recurrence_parent_id = $1 ORDER BY date', [antwort.body.id]);
    expect(rows.map((r) => r.date)).toEqual(['2027-04-01', '2027-05-01', '2027-06-01', '2027-07-01', '2027-08-01']);
    const audit = await f.admin.query("SELECT performed_by, organization_id FROM audit_logs WHERE table_name = 'events' AND record_id = $1", [antwort.body.id]);
    expect(audit.rows).toEqual([{ performed_by: ids.olga, organization_id: ids.alpha }]);
  });

  it('zeigt jedem nur die Termine seiner Sichtbarkeitsstufe (Mitglied, Vorstand, Admin, nur AG)', async () => {
    const pub = await legeAn(ids.olga, { title: 'S-public', allowed_roles: ['public', 'member', 'committee', 'admin'] });
    const mem = await legeAn(ids.olga, { title: 'S-member', allowed_roles: ['member', 'committee', 'admin'] });
    const kom = await legeAn(ids.olga, { title: 'S-committee', allowed_roles: ['committee', 'admin'] });
    const adm = await legeAn(ids.olga, { title: 'S-admin', allowed_roles: ['admin'] });
    const agNur = await legeAn(ids.olga, { title: 'S-ag', allowed_roles: [], working_group_id: technik });
    const sichtbar = async (konto: string) =>
      (await f.api('get', e(ids.alpha), konto)).body.filter((t: { title: string }) => t.title.startsWith('S-')).map((t: { title: string }) => t.title).sort();

    expect(await sichtbar(ids.olga)).toEqual(['S-admin', 'S-ag', 'S-committee', 'S-member', 'S-public']);
    expect(await sichtbar(ids.clara)).toEqual(['S-committee', 'S-member', 'S-public']);
    expect(await sichtbar(ids.anna)).toEqual(['S-ag', 'S-member', 'S-public']); // Anna ist in Technik
    expect(await sichtbar(ids.paul)).toEqual(['S-member', 'S-public']);

    // Verborgene Termine gibt es für den Aufrufer nicht (404 statt 403), auch nicht per Pfad einer anderen Organisation
    for (const [konto, verborgen] of [[ids.anna, kom], [ids.anna, adm], [ids.paul, agNur], [ids.clara, adm]] as const) {
      expect((await f.api('get', e(ids.alpha, `/${verborgen}`), konto)).status).toBe(404);
    }
    expect((await f.api('get', e(ids.alpha, `/${mem}`), ids.anna)).status).toBe(200);
    expect((await f.api('get', e(ids.beta, `/${pub}`), ids.clara)).status).toBe(404); // Claras Beta-Mitgliedschaft sieht Alphas Termin nicht
    expect((await f.api('get', e(ids.alpha, `/${pub}`), ids.bernd)).status).toBe(403);
    expect((await f.api('get', e(ids.alpha, '/nicht-uuid'), ids.olga)).status).toBe(400);
  });

  it('ändert und löscht Termine nur mit Verwaltungsrecht und nicht über Organisationsgrenzen', async () => {
    const allgemein = await legeAn(ids.clara, { title: 'Ä-allgemein' });
    const agTermin = await legeAn(ids.olga, { title: 'Ä-ag', working_group_id: leitung });
    const betaTermin = await legeAn(ids.bernd, { title: 'Ä-beta' }, ids.beta);

    expect((await f.api('patch', e(ids.alpha, `/${allgemein}`), ids.anna, { title: 'Hack' })).status).toBe(403);
    expect((await f.api('patch', e(ids.alpha, `/${allgemein}`), ids.paul, { title: 'Hack' })).status).toBe(403);
    expect((await f.api('patch', e(ids.alpha, `/${agTermin}`), ids.paul, { title: 'Neu', location: 'Online' })).body).toMatchObject({ title: 'Neu', location: 'Online' });
    // Paul darf den AG-Termin nicht in eine fremde AG oder zu einem allgemeinen Termin machen
    expect((await f.api('patch', e(ids.alpha, `/${agTermin}`), ids.paul, { working_group_id: technik })).status).toBe(403);
    expect((await f.api('patch', e(ids.alpha, `/${agTermin}`), ids.paul, { working_group_id: null })).status).toBe(403);
    expect((await f.api('patch', e(ids.alpha, `/${allgemein}`), ids.clara, { organization_id: ids.beta })).status).toBe(400);
    expect((await f.api('patch', e(ids.alpha, `/${betaTermin}`), ids.olga, { title: 'Hack' })).status).toBe(404);
    expect((await f.api('delete', e(ids.alpha, `/${betaTermin}`), ids.olga)).status).toBe(404);

    expect((await f.api('delete', e(ids.alpha, `/${allgemein}`), ids.anna)).status).toBe(403);
    expect((await f.api('delete', e(ids.alpha, `/${allgemein}`), ids.clara)).status).toBe(204);
    expect((await f.api('get', e(ids.alpha, `/${allgemein}`), ids.olga)).status).toBe(404);
    const spur = await f.admin.query("SELECT operation FROM audit_logs WHERE record_id = $1 ORDER BY created_at", [allgemein]);
    expect(spur.rows.map((r) => r.operation)).toEqual(['INSERT', 'DELETE']);
  });

  it('verwaltet Anmeldungen: eigene Zusage, Teilnehmerliste, Zusammenfassung, Abmeldung', async () => {
    const id = await legeAn(ids.olga, { title: 'R-anmeldung', registration_required: true });
    const verborgen = await legeAn(ids.olga, { title: 'R-admin', allowed_roles: ['admin'] });

    expect((await f.api('put', e(ids.alpha, `/${id}/registration`), ids.anna, { status: 'confirmed' })).body).toEqual({ event_id: id, status: 'confirmed' });
    expect((await f.api('put', e(ids.alpha, `/${id}/registration`), ids.paul, { status: 'maybe', note: 'vielleicht' })).status).toBe(200);
    expect((await f.api('put', e(ids.alpha, `/${id}/registration`), ids.anna, { status: 'zugesagt' })).status).toBe(400);
    expect((await f.api('put', e(ids.alpha, `/${verborgen}/registration`), ids.anna, {})).status).toBe(404);
    expect((await f.api('put', e(ids.alpha, `/${id}/registration`), ids.bernd, {})).status).toBe(403);

    expect((await f.api('get', e(ids.alpha, '/registrations/mine'), ids.anna)).body).toEqual([{ event_id: id, status: 'confirmed' }]);
    const liste = await f.api('get', e(ids.alpha, `/${id}/registrations`), ids.clara);
    expect(liste.body.map((x: { member: { name: string } }) => x.member.name).sort()).toEqual(['Anna', 'Paul']);

    const summe = await f.api('post', e(ids.alpha, '/registrations/summary'), ids.clara, { event_ids: [id, verborgen] });
    expect(summe.body[id].count).toBe(1); // nur „confirmed“ zählt
    expect(summe.body[id].avatars).toEqual([{ name: 'Anna', avatar_url: null }]);
    expect(summe.body[verborgen]).toBeUndefined(); // unsichtbare Termine tauchen nicht auf
    expect((await f.api('post', e(ids.alpha, '/registrations/summary'), ids.clara, { event_ids: [] })).status).toBe(400);

    expect((await f.api('delete', e(ids.alpha, `/${id}/registration`), ids.anna)).status).toBe(204);
    expect((await f.api('get', e(ids.alpha, '/registrations/mine'), ids.anna)).body).toEqual([]);
  });

  it('überbucht einen Termin mit Teilnehmerlimit auch bei gleichzeitigen Anmeldungen nie', async () => {
    // Mehrere Runden mit frischen Terminen: ohne Sperre würde mindestens eine Runde überbuchen.
    for (let runde = 0; runde < 12; runde += 1) {
      const id = await legeAn(ids.olga, { title: `R-limit-${runde}`, max_participants: 1 });

      const antworten = await Promise.all([ids.anna, ids.paul, ids.clara].map((k) => f.api('put', e(ids.alpha, `/${id}/registration`), k, { status: 'confirmed' })));

      expect(antworten.map((a) => a.status).sort(), `Runde ${runde}`).toEqual([200, 409, 409]);
      expect(antworten.find((a) => a.status === 409)?.body.code).toBe('event_full');
      const { rows } = await f.admin.query("SELECT count(*)::int AS n FROM event_registrations WHERE event_id = $1 AND status = 'confirmed'", [id]);
      expect(rows[0].n, `Runde ${runde}`).toBe(1);
      if (runde === 0) {
        // Wer schon zugesagt hat, kann erneut zusagen (z. B. Notiz ändern), ohne am Limit zu scheitern.
        const sieger = [ids.anna, ids.paul, ids.clara][antworten.findIndex((a) => a.status === 200)];
        expect((await f.api('put', e(ids.alpha, `/${id}/registration`), sieger, { status: 'confirmed', note: 'mit Gast' })).status).toBe(200);
      }
    }
  });

  describe('Helferslots', () => {
    let ev: string;
    let skill: string;
    let fremderSkill: string;
    let slot: string;
    const s = (rest = '') => `/api/v1/orgs/${ids.alpha}/slots${rest}`;

    beforeAll(async () => {
      ev = await legeAn(ids.olga, { title: 'H-fest' });
      skill = (await f.admin.query("INSERT INTO skills (organization_id, name) VALUES ($1, 'Grillen') RETURNING id", [ids.alpha])).rows[0].id;
      fremderSkill = (await f.admin.query("INSERT INTO skills (organization_id, name) VALUES ($1, 'Fremd') RETURNING id", [ids.beta])).rows[0].id;
    });

    it('legt Slots nur für Verwaltende an und prüft Fähigkeiten gegen die eigene Organisation', async () => {
      const neu = await f.api('post', e(ids.alpha, `/${ev}/slots`), ids.olga, { title: 'Grill', max_helpers: 1, start_time: '10:00', required_skills: [skill] });
      expect(neu.status).toBe(201);
      expect(neu.body).toMatchObject({ title: 'Grill', max_helpers: 1, organization_id: ids.alpha, required_skills: [skill] });
      slot = neu.body.id;

      expect((await f.api('post', e(ids.alpha, `/${ev}/slots`), ids.anna, { title: 'X' })).status).toBe(403);
      expect((await f.api('post', e(ids.alpha, `/${ev}/slots`), ids.olga, { title: 'X', required_skills: [fremderSkill] })).status).toBe(400);
      expect((await f.api('post', e(ids.alpha, `/${ev}/slots`), ids.olga, { title: 'X', max_helpers: 0 })).status).toBe(400);
      expect((await f.api('post', e(ids.alpha, `/${ev}/slots`), ids.olga, { title: 'X', organization_id: ids.beta })).status).toBe(400);
      expect((await f.api('post', e(ids.alpha, `/${ids.unbekannt}/slots`), ids.olga, { title: 'X' })).status).toBe(404);
    });

    it('lässt bei gleichzeitiger Anmeldung nur so viele Helfer zu, wie der Slot Plätze hat', async () => {
      const antworten = await Promise.all([ids.anna, ids.paul].map((k) => f.api('put', s(`/${slot}/signup`), k, {})));

      expect(antworten.map((a) => a.status).sort()).toEqual([200, 409]);
      expect(antworten.find((a) => a.status === 409)?.body.code).toBe('slot_full');
      const { rows } = await f.admin.query("SELECT count(*)::int AS n FROM event_slot_signups WHERE slot_id = $1 AND status = 'confirmed'", [slot]);
      expect(rows[0].n).toBe(1);
    });

    it('zeigt Slots mit bestätigten Helfern, Zählung und eigener Anmeldung; „meine Anmeldungen“ mit Termin', async () => {
      const gewinner = (await f.admin.query("SELECT member_id FROM event_slot_signups WHERE slot_id = $1", [slot])).rows[0].member_id;
      const konto = gewinner === ids.annaMitglied ? ids.anna : ids.paul;
      const anderer = konto === ids.anna ? ids.paul : ids.anna;

      const meiner = (await f.api('get', e(ids.alpha, `/${ev}/slots`), konto)).body[0];
      const fremder = (await f.api('get', e(ids.alpha, `/${ev}/slots`), anderer)).body[0];
      expect(meiner).toMatchObject({ id: slot, signup_count: 1, is_signed_up: true });
      expect(fremder).toMatchObject({ signup_count: 1, is_signed_up: false });
      expect(meiner.signups[0].member).toMatchObject({ id: gewinner });

      const meine = await f.api('get', `/api/v1/orgs/${ids.alpha}/slots/signups/mine`, konto);
      expect(meine.body).toHaveLength(1);
      expect(meine.body[0].slot).toMatchObject({ id: slot, title: 'Grill', event: { id: ev, title: 'H-fest' } });
    });

    it('verbietet ein Limit unter der Zahl der Helfer und gibt nach Abmeldung den Platz wieder frei', async () => {
      const gewinner = (await f.admin.query("SELECT member_id FROM event_slot_signups WHERE slot_id = $1", [slot])).rows[0].member_id;
      const konto = gewinner === ids.annaMitglied ? ids.anna : ids.paul;
      const anderer = konto === ids.anna ? ids.paul : ids.anna;
      await f.api('post', e(ids.alpha, `/${ev}/slots`), ids.olga, { title: 'Zwei', max_helpers: 2 }); // zweiter Slot stört nicht

      expect((await f.api('patch', s(`/${slot}`), ids.olga, { max_helpers: 0 })).status).toBe(400);
      await f.admin.query("UPDATE event_slots SET max_helpers = 2 WHERE id = $1", [slot]);
      await f.api('put', s(`/${slot}/signup`), anderer, {});
      const zuWenig = await f.api('patch', s(`/${slot}`), ids.olga, { max_helpers: 1 });
      expect(zuWenig.status).toBe(409);
      expect(zuWenig.body.code).toBe('slot_over_capacity');

      expect((await f.api('patch', s(`/${slot}`), ids.anna, { title: 'Hack' })).status).toBe(403);
      expect((await f.api('delete', s(`/${slot}/signup`), anderer)).status).toBe(204);
      expect((await f.api('patch', s(`/${slot}`), ids.olga, { max_helpers: 1, title: 'Grillstand' })).body).toMatchObject({ max_helpers: 1, title: 'Grillstand' });
    });

    it('hält Slots anderer Organisationen und unsichtbarer Termine verschlossen', async () => {
      const betaEv = await legeAn(ids.bernd, { title: 'H-beta' }, ids.beta);
      const betaSlot = (await f.api('post', e(ids.beta, `/${betaEv}/slots`), ids.bernd, { title: 'B', max_helpers: 3 })).body.id;
      const verborgen = await legeAn(ids.olga, { title: 'H-admin', allowed_roles: ['admin'] });
      const verborgenerSlot = (await f.api('post', e(ids.alpha, `/${verborgen}/slots`), ids.olga, { title: 'V' })).body.id;

      expect((await f.api('put', s(`/${betaSlot}/signup`), ids.anna, {})).status).toBe(404); // fremde Organisation über Alpha-Pfad
      expect((await f.api('patch', s(`/${betaSlot}`), ids.olga, { title: 'Hack' })).status).toBe(404);
      expect((await f.api('delete', s(`/${betaSlot}`), ids.olga)).status).toBe(404);
      expect((await f.api('put', s(`/${verborgenerSlot}/signup`), ids.anna, {})).status).toBe(404); // Termin für Anna unsichtbar
      expect((await f.api('get', e(ids.alpha, `/${verborgen}/slots`), ids.anna)).status).toBe(404);
      expect((await f.api('get', s('/nicht-uuid'), ids.anna)).status).toBe(404);
    });

    it('schlägt passende Einsätze vor: Fähigkeitstreffer zuerst, höchstens drei, ohne volle, vergangene und bereits belegte', async () => {
      const lauf = await legeAn(ids.olga, { title: 'M-lauf', date: inTagen(5) });
      const spaeter = await legeAn(ids.olga, { title: 'M-spaeter', date: inTagen(8) });
      const vorbei = await legeAn(ids.olga, { title: 'M-vorbei', date: inTagen(-3) });
      const mk = async (event: string, title: string, max: number, skills: string[] = []) =>
        (await f.api('post', e(ids.alpha, `/${event}/slots`), ids.olga, { title, max_helpers: max, required_skills: skills })).body.id as string;
      const treffer = await mk(spaeter, 'M-treffer', 2, [skill]);
      await mk(lauf, 'M-ohne', 2);
      await mk(lauf, 'M-ohne2', 2);
      await mk(lauf, 'M-ohne3', 2);
      await mk(vorbei, 'M-alt', 2, [skill]);
      const voll = await mk(lauf, 'M-voll', 1, [skill]);
      await f.api('put', s(`/${voll}/signup`), ids.paul, {});
      await f.admin.query('INSERT INTO member_skills (member_id, skill_id) VALUES ($1, $2)', [ids.annaMitglied, skill]);

      const antwort = await f.api('get', `/api/v1/orgs/${ids.alpha}/matching/opportunities`, ids.anna);

      expect(antwort.status).toBe(200);
      expect(antwort.body.has_skills).toBe(true);
      const titel = antwort.body.opportunities.map((o: { slot_title: string }) => o.slot_title);
      expect(titel).toHaveLength(3);
      expect(titel[0]).toBe('M-treffer');
      expect(titel).not.toContain('M-alt');
      expect(titel).not.toContain('M-voll');
      expect(antwort.body.opportunities[0]).toMatchObject({ slot_id: treffer, event_title: 'M-spaeter', matching_skills: ['Grillen'], has_skill_match: true, remaining_spots: 2 });

      // Wer schon im Slot steht, bekommt ihn nicht erneut vorgeschlagen
      await f.api('put', s(`/${treffer}/signup`), ids.anna, {});
      const danach = (await f.api('get', `/api/v1/orgs/${ids.alpha}/matching/opportunities`, ids.anna)).body.opportunities.map((o: { slot_title: string }) => o.slot_title);
      expect(danach).not.toContain('M-treffer');
      expect((await f.api('get', `/api/v1/orgs/${ids.alpha}/matching/opportunities`, ids.bernd)).status).toBe(403);
    });
  });

  describe('Gastorganisationen', () => {
    let ev: string;
    let gast: string;
    const g = (rest = '') => `/api/v1/orgs/${ids.alpha}${rest}`;

    beforeAll(async () => {
      ev = await legeAn(ids.olga, { title: 'G-gipfel', location: 'Halle 1' });
    });

    it('lädt eine bestehende Organisation ein, sendet die Mail an deren Besitzer und lehnt Doppel und Selbst-Einladung ab', async () => {
      const antwort = await f.api('post', e(ids.alpha, `/${ev}/guests`), ids.olga, { guest_organization_id: ids.beta });

      expect(antwort.status).toBe(201);
      expect(antwort.body).toMatchObject({ guest_organization_id: ids.beta, status: 'pending', host_organization_id: ids.alpha, invited_by: ids.olgaMitglied });
      gast = antwort.body.id;
      expect(f.pgApp.dispatcher.dispatch).toHaveBeenCalledTimes(1);
      const [art, nachricht] = f.pgApp.dispatcher.dispatch.mock.calls[0] as [string, { to: string; subject: string; text: string }];
      expect(art).toBe('gast-einladung');
      expect(nachricht.to).toBe('bernd@example.org');
      expect(nachricht.subject).toContain('Alpha e. V.');
      expect(nachricht.text).toContain(`https://app.pulsedeck.example/event/${ev}`);

      const doppelt = await f.api('post', e(ids.alpha, `/${ev}/guests`), ids.olga, { guest_organization_id: ids.beta });
      expect(doppelt.status).toBe(409);
      expect(doppelt.body.code).toBe('guest_already_invited');
      expect((await f.api('post', e(ids.alpha, `/${ev}/guests`), ids.olga, { guest_organization_id: ids.alpha })).status).toBe(400);
      expect((await f.api('post', e(ids.alpha, `/${ev}/guests`), ids.olga, { guest_organization_id: ids.unbekannt })).status).toBe(404);
      expect(f.pgApp.dispatcher.dispatch).toHaveBeenCalledTimes(1); // gescheiterte Einladungen senden nichts
    });

    it('lädt externe Gäste per Name und E-Mail ein (E-Mail normalisiert, Doppel mit anderer Schreibweise abgelehnt)', async () => {
      const antwort = await f.api('post', e(ids.alpha, `/${ev}/guests`), ids.clara, { guest_org_name: 'Nachbarverein', guest_org_email: ' Kontakt@Nachbar.Example ', guest_org_contact_name: 'Frau Meier' });

      expect(antwort.status).toBe(201);
      expect(antwort.body).toMatchObject({ guest_org_name: 'Nachbarverein', guest_org_email: 'kontakt@nachbar.example', guest_organization_id: null });
      expect((f.pgApp.dispatcher.dispatch.mock.calls[0] as [string, { to: string; text: string }])[1]).toMatchObject({ to: 'kontakt@nachbar.example' });
      expect((f.pgApp.dispatcher.dispatch.mock.calls[0] as [string, { text: string }])[1].text).toContain('Hallo Frau Meier');
      expect((await f.api('post', e(ids.alpha, `/${ev}/guests`), ids.olga, { guest_org_name: 'Nachbarverein', guest_org_email: 'KONTAKT@nachbar.example' })).status).toBe(409);
      for (const falsch of [{}, { guest_org_name: 'Nur Name' }, { guest_org_email: 'a@b.example' }, { guest_org_name: 'X', guest_org_email: 'keine-mail' }, { status: 'accepted', guest_org_name: 'X', guest_org_email: 'x@y.example' }]) {
        expect((await f.api('post', e(ids.alpha, `/${ev}/guests`), ids.olga, falsch)).status, JSON.stringify(falsch)).toBe(400);
      }
    });

    it('beschränkt Einladen, Entfernen und Kontaktdaten auf Verwaltende', async () => {
      expect((await f.api('post', e(ids.alpha, `/${ev}/guests`), ids.anna, { guest_organization_id: ids.beta })).status).toBe(403);
      expect((await f.api('delete', e(ids.alpha, `/${ev}/guests/${gast}`), ids.anna)).status).toBe(403);
      expect((await f.api('post', e(ids.beta, `/${ev}/guests`), ids.bernd, { guest_organization_id: ids.alpha })).status).toBe(404); // Termin gehört Alpha

      const verwaltung = (await f.api('get', e(ids.alpha, `/${ev}/guests`), ids.olga)).body;
      expect(verwaltung).toHaveLength(2);
      expect(verwaltung.some((x: { guest_org_email: string | null }) => x.guest_org_email === 'kontakt@nachbar.example')).toBe(true);
      // Mitglieder sehen nur angenommene Gäste und keine Kontaktdaten
      expect((await f.api('get', e(ids.alpha, `/${ev}/guests`), ids.anna)).body).toEqual([]);
    });

    it('sucht Organisationen: mindestens zwei Zeichen, höchstens zehn Treffer, ohne eigene, Wildcards wörtlich', async () => {
      for (let i = 0; i < 12; i += 1) await f.admin.query("INSERT INTO organizations (slug, name) VALUES ($1, $2)", [`suche-${i}`, `Suchverein ${String(i).padStart(2, '0')}`]);

      const treffer = await f.api('get', g('/guest-organizations/search?q=such'), ids.clara);
      expect(treffer.status).toBe(200);
      expect(treffer.body).toHaveLength(10);
      expect(Object.keys(treffer.body[0]).sort()).toEqual(['id', 'logo_url', 'name', 'slug']);
      expect((await f.api('get', g('/guest-organizations/search?q=alp'), ids.clara)).body).toEqual([]); // eigene Organisation ausgenommen
      expect((await f.api('get', g('/guest-organizations/search?q=be'), ids.clara)).body.map((o: { name: string }) => o.name)).toContain('Beta e. V.');
      expect((await f.api('get', g('/guest-organizations/search?q=b'), ids.clara)).body).toEqual([]);
      expect((await f.api('get', g('/guest-organizations/search?q=%25%25'), ids.clara)).body).toEqual([]);
      expect((await f.api('get', g('/guest-organizations/search?q=such'), ids.anna)).status).toBe(403);
      expect((await f.api('get', g('/guest-organizations/search'), ids.clara)).status).toBe(400);
    });

    it('lässt nur Admin/Vorstand der eingeladenen Organisation antworten, genau einmal und nur für die eigene Einladung', async () => {
      const b = (rest = '') => `/api/v1/orgs/${ids.beta}${rest}`;
      const offen = await f.api('get', b('/guest-invitations'), ids.bernd);
      expect(offen.status).toBe(200);
      expect(offen.body).toHaveLength(1);
      expect(offen.body[0]).toMatchObject({ id: gast, event: { id: ev, title: 'G-gipfel', location: 'Halle 1' }, host_organization: { id: ids.alpha, name: 'Alpha e. V.' } });

      expect((await f.api('get', b('/guest-invitations'), ids.clara)).status).toBe(403); // Clara ist in Beta nur Mitglied
      expect((await f.api('patch', b(`/guest-invitations/${gast}`), ids.clara, { status: 'accepted' })).status).toBe(403);
      expect((await f.api('patch', g(`/guest-invitations/${gast}`), ids.olga, { status: 'accepted' })).status).toBe(404); // Alpha ist nicht der Gast
      expect((await f.api('patch', b(`/guest-invitations/${gast}`), ids.bernd, { status: 'pending' })).status).toBe(400);
      expect((await f.api('patch', b(`/guest-invitations/${gast}`), ids.bernd, { status: 'accepted', event_id: ev })).status).toBe(400);

      const angenommen = await f.api('patch', b(`/guest-invitations/${gast}`), ids.bernd, { status: 'accepted' });
      expect(angenommen.body).toMatchObject({ id: gast, status: 'accepted' });
      expect(angenommen.body.responded_at).not.toBeNull();
      const nochmal = await f.api('patch', b(`/guest-invitations/${gast}`), ids.bernd, { status: 'declined' });
      expect(nochmal.status).toBe(409);
      expect(nochmal.body.code).toBe('invitation_answered');
      expect((await f.api('get', b('/guest-invitations'), ids.bernd)).body).toEqual([]);
    });

    it('zeigt angenommene Gäste allen Mitgliedern und dem Gast den Termin im Kalender; Entfernen löscht die Einladung', async () => {
      const fuerMitglied = (await f.api('get', e(ids.alpha, `/${ev}/guests`), ids.anna)).body;
      expect(fuerMitglied).toHaveLength(1);
      expect(fuerMitglied[0]).toMatchObject({ id: gast, organization_name: 'Beta e. V.' });
      expect(fuerMitglied[0]).not.toHaveProperty('guest_org_email');

      const kalender = await f.api('get', `/api/v1/orgs/${ids.beta}/guest-events`, ids.bernd);
      expect(kalender.body).toHaveLength(1);
      expect(kalender.body[0]).toMatchObject({ id: ev, title: 'G-gipfel', host_organization: { name: 'Alpha e. V.' } });
      expect((await f.api('get', `/api/v1/orgs/${ids.beta}/guest-events`, ids.olga)).status).toBe(403);

      expect((await f.api('delete', e(ids.alpha, `/${ev}/guests/${gast}`), ids.olga)).status).toBe(204);
      expect((await f.api('delete', e(ids.alpha, `/${ev}/guests/${gast}`), ids.olga)).status).toBe(404);
      expect((await f.api('get', `/api/v1/orgs/${ids.beta}/guest-events`, ids.bernd)).body).toEqual([]);
    });
  });

  describe('Öffentliche Termin-Seite', () => {
    it('liefert öffentliche Termine anonym mit Organisation, alle anderen als 404', async () => {
      const oeffentlich = await legeAn(ids.olga, { title: 'P-oeffentlich', allowed_roles: ['public', 'member'] });
      const intern = await legeAn(ids.olga, { title: 'P-intern', allowed_roles: ['member', 'committee', 'admin'] });
      const agNur = await legeAn(ids.olga, { title: 'P-ag', allowed_roles: [], working_group_id: technik });

      const antwort = await f.api('get', `/api/v1/public/events/${oeffentlich}`, null);

      expect(antwort.status).toBe(200);
      expect(antwort.body).toMatchObject({ title: 'P-oeffentlich', organization: { name: 'Alpha e. V.', slug: 'alpha' } });
      expect(antwort.body).not.toHaveProperty('registrations');
      for (const id of [intern, agNur, ids.unbekannt]) expect((await f.api('get', `/api/v1/public/events/${id}`, null)).status, id).toBe(404);
      expect((await f.api('get', '/api/v1/public/events/keine-uuid', null)).status).toBe(400);
    });
  });
});
