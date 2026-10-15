import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { erstelleFixture, type Fixture } from '../../test/fixture';

/**
 * Mitglieder und Rollen gegen echtes PostgreSQL und die echte HTTP-Kette: Sichtbarkeit je Rolle,
 * privilegierte Felder, Mandantentrennung, Besitzer-/Letzter-Admin-Schutz, parallele Kapazitätsprüfung,
 * Konto-Bereinigung beim Löschen, Einladungen.
 */
describe('Mitglieder und Rollen (echtes PostgreSQL)', () => {
  let f: Fixture;
  let ids: Fixture['ids'];
  const m = (org: string) => `/api/v1/orgs/${org}/members`;

  beforeAll(async () => {
    f = await erstelleFixture('pulsedeck_members_test');
    ids = f.ids;
    // Alpha ist Pro (kein Mitgliederlimit); das Limit prüft der Test mit Beta.
    await f.admin.query("UPDATE organizations SET subscription_tier = 'pro' WHERE id = $1", [ids.alpha]);
  });
  afterAll(async () => {
    await f.schliessen();
  });
  beforeEach(() => {
    f.pgApp.mailer.sendInvitationEmail.mockClear();
    f.pgApp.mailer.sendPasswordResetEmail.mockClear();
  });

  async function neuesMitglied(email: string, extra: object = {}, org = ids.alpha): Promise<string> {
    const antwort = await f.api('post', m(org), org === ids.alpha ? ids.olga : ids.bernd, { name: `Mitglied ${email}`, email, ...extra });
    expect(antwort.status, JSON.stringify(antwort.body)).toBe(201);
    return antwort.body.id;
  }

  describe('Liste (GET /members)', () => {
    it('zeigt Administratoren und Vorstand die Stammdaten, aber nie Verknüpfungs- oder Kalender-Token', async () => {
      await f.admin.query("UPDATE members SET phone = '0151', birthday = '1990-01-01', connection_token = 'geheim-link', calendar_token = 'geheim-kal' WHERE id = $1", [ids.annaMitglied]);

      for (const konto of [ids.olga, ids.clara]) {
        const antwort = await f.api('get', m(ids.alpha), konto);
        expect(antwort.status).toBe(200);
        const anna = antwort.body.find((x: { id: string }) => x.id === ids.annaMitglied);
        expect(anna).toMatchObject({ name: 'Anna', phone: '0151', birthday: '1990-01-01', user_id: ids.anna });
        expect(JSON.stringify(antwort.body)).not.toContain('geheim-link');
        expect(JSON.stringify(antwort.body)).not.toContain('geheim-kal');
        expect(anna).not.toHaveProperty('connection_token');
        expect(anna).not.toHaveProperty('calendar_token');
      }
    });

    it('zeigt normalen Mitgliedern nur das Verzeichnis (keine Kontaktdaten, Geburtstage, Konto-IDs)', async () => {
      const antwort = await f.api('get', m(ids.alpha), ids.anna);

      expect(antwort.status).toBe(200);
      const anna = antwort.body.find((x: { id: string }) => x.id === ids.annaMitglied);
      expect(Object.keys(anna).sort()).toEqual(['app_role', 'avatar_url', 'department', 'id', 'name', 'organization_id', 'role', 'status']);
      expect(JSON.stringify(antwort.body)).not.toContain('0151');
    });

    it('liefert nur die eigene Organisation; Fremde und anonyme Anfragen werden abgewiesen', async () => {
      const antwort = await f.api('get', m(ids.alpha), ids.olga);
      expect(antwort.body.every((x: { organization_id: string }) => x.organization_id === ids.alpha)).toBe(true);
      expect(antwort.body.map((x: { name: string }) => x.name)).toEqual([...antwort.body.map((x: { name: string }) => x.name)].sort((a, b) => a.localeCompare(b)));
      expect((await f.api('get', m(ids.alpha), ids.bernd)).status).toBe(403);
      expect((await f.api('get', m(ids.alpha), null)).status).toBe(401);
    });
  });

  describe('Anlegen (POST /members)', () => {
    it('legt ein Mitglied mit Standardrolle und Standardwerten an und schreibt Audit', async () => {
      const antwort = await f.api('post', m(ids.alpha), ids.olga, { name: 'Neu Mitglied', email: ' Neu.Mitglied@Example.ORG ' });

      expect(antwort.status).toBe(201);
      expect(antwort.body).toMatchObject({
        organization_id: ids.alpha,
        email: 'neu.mitglied@example.org',
        role_id: ids.alphaMitgliedRolle,
        app_role: 'member',
        status: 'Active',
        role: 'Mitglied',
        user_id: null,
      });
      expect(antwort.body.join_date).toMatch(/^\d{1,2}\.\d{1,2}\.\d{4}$/);
      const audit = await f.admin.query("SELECT performed_by FROM audit_logs WHERE table_name = 'members' AND operation = 'INSERT' AND record_id = $1", [antwort.body.id]);
      expect(audit.rows).toEqual([{ performed_by: ids.olga }]);
    });

    it('setzt app_role auf admin, wenn eine Systemadministrator-Rolle zugewiesen wird', async () => {
      const antwort = await f.api('post', m(ids.alpha), ids.olga, { name: 'Zweite Admin', email: 'zweite.admin@example.org', role_id: ids.alphaAdminRolle });

      expect(antwort.body).toMatchObject({ role_id: ids.alphaAdminRolle, app_role: 'admin' });
    });

    it('verweigert Mitgliedern, Vorstand und Fremden das Anlegen', async () => {
      for (const konto of [ids.anna, ids.clara, ids.bernd]) {
        expect((await f.api('post', m(ids.alpha), konto, { name: 'X', email: `x-${konto.slice(-2)}@example.org` })).status, konto).toBe(403);
      }
      expect((await f.api('post', m(ids.alpha), null, { name: 'X', email: 'x@example.org' })).status).toBe(401);
    });

    it('lehnt privilegierte und unbekannte Felder ab, die ein Administrator nicht setzen darf', async () => {
      for (const feld of [
        { user_id: ids.anna },
        { organization_id: ids.beta },
        { calendar_token: 'abc' },
        { connection_token: 'abc' },
        { id: ids.beta },
        { permissions: ['feed:delete'] },
        { status: 'Gelöscht' },
      ]) {
        const antwort = await f.api('post', m(ids.alpha), ids.olga, { name: 'X', email: 'feld@example.org', ...feld });
        expect(antwort.status, JSON.stringify(feld)).toBe(400);
      }
    });

    it('lehnt Rollen fremder Organisationen ab und meldet doppelte E-Mails als 409', async () => {
      const fremdeRolle = await f.api('post', m(ids.alpha), ids.olga, { name: 'Quer', email: 'quer@example.org', role_id: ids.betaAdminRolle });
      expect(fremdeRolle.status).toBe(400);
      await neuesMitglied('doppelt@example.org');
      const doppelt = await f.api('post', m(ids.alpha), ids.olga, { name: 'Doppelt', email: 'DOPPELT@example.org' });
      expect(doppelt.status).toBe(409);
      expect(doppelt.body.code).toBe('email_taken');
    });

    it('hält das Mitgliederlimit auch bei parallelen Anlagen ein (genau so viele Plätze wie frei)', async () => {
      const { rows } = await f.admin.query('SELECT count(*)::int AS n FROM members WHERE organization_id = $1', [ids.beta]);
      await f.admin.query('UPDATE organizations SET max_members = $2 WHERE id = $1', [ids.beta, rows[0].n + 2]);

      const antworten = await Promise.all(
        Array.from({ length: 6 }, (_, i) => f.api('post', m(ids.beta), ids.bernd, { name: `Rennen ${i}`, email: `rennen${i}@example.org` }))
      );

      const erfolgreich = antworten.filter((a) => a.status === 201).length;
      const abgelehnt = antworten.filter((a) => a.status === 409 && a.body.code === 'member_limit_reached').length;
      expect([erfolgreich, abgelehnt]).toEqual([2, 4]);
      const nachher = await f.admin.query('SELECT count(*)::int AS n FROM members WHERE organization_id = $1', [ids.beta]);
      expect(nachher.rows[0].n).toBe(rows[0].n + 2);

      await f.admin.query("UPDATE organizations SET subscription_tier = 'pro' WHERE id = $1", [ids.beta]);
      expect((await f.api('post', m(ids.beta), ids.bernd, { name: 'Pro', email: 'pro@example.org' })).status).toBe(201);
      await f.admin.query("UPDATE organizations SET subscription_tier = 'free', max_members = 10 WHERE id = $1", [ids.beta]);
    });
  });

  describe('Import (POST /members/import)', () => {
    it('aktualisiert vorhandene E-Mails, legt neue an und lässt Rolle und Konto unangetastet', async () => {
      const vorhanden = await neuesMitglied('import.alt@example.org', { phone: '111', role_id: ids.alphaAdminRolle });

      const antwort = await f.api('post', `${m(ids.alpha)}/import`, ids.olga, {
        members: [
          { name: 'Import Alt Neu', email: 'Import.Alt@example.org', phone: '222' },
          { name: 'Import Neu', email: 'import.neu@example.org', city: 'Berlin' },
          { name: 'Import Neu Zwei', email: 'IMPORT.NEU@example.org', city: 'Hamburg' }, // doppelt: letzter gewinnt
        ],
      });

      expect(antwort.status).toBe(200);
      expect(antwort.body).toHaveLength(2);
      const alt = await f.admin.query('SELECT name, phone, role_id, app_role FROM members WHERE id = $1', [vorhanden]);
      expect(alt.rows[0]).toEqual({ name: 'Import Alt Neu', phone: '222', role_id: ids.alphaAdminRolle, app_role: 'admin' });
      const neu = await f.admin.query("SELECT name, city, role_id, app_role, status FROM members WHERE email = 'import.neu@example.org'");
      expect(neu.rows).toEqual([{ name: 'Import Neu Zwei', city: 'Hamburg', role_id: ids.alphaMitgliedRolle, app_role: 'member', status: 'Active' }]);
    });

    it('lehnt privilegierte Felder und ungültige Zeilen ab, ohne etwas zu ändern', async () => {
      const vorher = await f.admin.query('SELECT count(*)::int AS n FROM members');
      for (const zeile of [{ role_id: ids.alphaAdminRolle }, { app_role: 'admin' }, { user_id: ids.anna }, { permissions: ['wiki:edit'] }]) {
        const antwort = await f.api('post', `${m(ids.alpha)}/import`, ids.olga, {
          members: [{ name: 'Gut', email: 'gut@example.org' }, { name: 'Böse', email: 'boese@example.org', ...zeile }],
        });
        expect(antwort.status, JSON.stringify(zeile)).toBe(400);
      }
      expect((await f.api('post', `${m(ids.alpha)}/import`, ids.olga, { members: [] })).status).toBe(400);
      const nachher = await f.admin.query('SELECT count(*)::int AS n FROM members');
      expect(nachher.rows[0].n).toBe(vorher.rows[0].n);
    });

    it('wirkt nur für Administratoren der eigenen Organisation', async () => {
      const koerper = { members: [{ name: 'X', email: 'importfremd@example.org' }] };
      expect((await f.api('post', `${m(ids.alpha)}/import`, ids.anna, koerper)).status).toBe(403);
      expect((await f.api('post', `${m(ids.alpha)}/import`, ids.bernd, koerper)).status).toBe(403);
    });
  });

  describe('Ändern (PATCH /members/:id)', () => {
    it('ändert Stammdaten und synchronisiert app_role mit der Rolle', async () => {
      const id = await neuesMitglied('aendern@example.org');

      const hoch = await f.api('patch', `${m(ids.alpha)}/${id}`, ids.olga, { phone: '0123', role_id: ids.alphaAdminRolle });
      expect(hoch.status).toBe(200);
      expect(hoch.body).toMatchObject({ phone: '0123', app_role: 'admin', role_id: ids.alphaAdminRolle });

      const runter = await f.api('patch', `${m(ids.alpha)}/${id}`, ids.olga, { role_id: ids.alphaMitgliedRolle });
      expect(runter.body).toMatchObject({ app_role: 'member', role_id: ids.alphaMitgliedRolle });

      const audit = await f.admin.query("SELECT old_data->>'app_role' AS alt, new_data->>'app_role' AS neu FROM audit_logs WHERE table_name = 'members' AND operation = 'UPDATE' AND record_id = $1 ORDER BY created_at, id", [id]);
      expect(audit.rows).toEqual([{ alt: 'member', neu: 'admin' }, { alt: 'admin', neu: 'member' }]);
    });

    it('verweigert Nicht-Administratoren, fremden Organisationen und unbekannten Mitgliedern das Ändern', async () => {
      const id = await neuesMitglied('fremdaendern@example.org');
      expect((await f.api('patch', `${m(ids.alpha)}/${id}`, ids.anna, { phone: '1' })).status).toBe(403);
      expect((await f.api('patch', `${m(ids.alpha)}/${id}`, ids.clara, { phone: '1' })).status).toBe(403);
      expect((await f.api('patch', `${m(ids.alpha)}/${id}`, ids.bernd, { phone: '1' })).status).toBe(403);
      // Mitglied einer anderen Organisation über den eigenen Pfad ansteuern
      expect((await f.api('patch', `${m(ids.alpha)}/${ids.berndMitglied}`, ids.olga, { phone: '1' })).status).toBe(404);
      expect((await f.api('patch', `${m(ids.alpha)}/${ids.unbekannt}`, ids.olga, { phone: '1' })).status).toBe(404);
      expect((await f.api('patch', `${m(ids.alpha)}/kein-uuid`, ids.olga, { phone: '1' })).status).toBe(400);
    });

    it('erlaubt weder Konto-Verknüpfung noch Organisationswechsel noch Token', async () => {
      const id = await neuesMitglied('privileg@example.org');
      for (const feld of [{ user_id: ids.anna }, { organization_id: ids.beta }, { calendar_token: 'x' }, { connection_token: 'x' }]) {
        expect((await f.api('patch', `${m(ids.alpha)}/${id}`, ids.olga, feld)).status, JSON.stringify(feld)).toBe(400);
      }
    });

    it('schützt den Besitzer: Admin-Rolle bleibt, er kann nicht entfernt werden', async () => {
      const herabstufen = await f.api('patch', `${m(ids.alpha)}/${ids.olgaMitglied}`, ids.olga, { role_id: ids.alphaMitgliedRolle });
      expect(herabstufen.status).toBe(409);
      expect(herabstufen.body.code).toBe('owner_protected');
      const loeschen = await f.api('delete', `${m(ids.alpha)}/${ids.olgaMitglied}`, ids.olga);
      expect(loeschen.status).toBe(409);
      expect(loeschen.body.code).toBe('owner_protected');
    });

    it('lässt den letzten Administrator weder herabstufen noch löschen', async () => {
      await f.admin.query("INSERT INTO organizations (id, slug, name) VALUES ('10000000-0000-4000-8000-0000000000cc', 'gamma', 'Gamma')");
      await f.admin.query("INSERT INTO organization_roles (id, organization_id, name, is_system_admin) VALUES ('20000000-0000-4000-8000-0000000000c1', '10000000-0000-4000-8000-0000000000cc', 'Admin', true), ('20000000-0000-4000-8000-0000000000c2', '10000000-0000-4000-8000-0000000000cc', 'Mitglied', false)");
      await f.admin.query("UPDATE organization_roles SET is_default = true WHERE id = '20000000-0000-4000-8000-0000000000c2'");
      const gamma = '10000000-0000-4000-8000-0000000000cc';
      const gammaEins = '00000000-0000-4000-8000-0000000000c1';
      await f.admin.query("INSERT INTO auth_users (id, email, password_hash, email_verified) VALUES ($1, 'gamma-eins@example.org', 'x', true)", [gammaEins]);
      await f.admin.query(
        `INSERT INTO members (id, organization_id, user_id, role_id, app_role, name, status, email, join_date) VALUES
           ('30000000-0000-4000-8000-0000000000c1', $1, $2, '20000000-0000-4000-8000-0000000000c1', 'admin', 'Gamma Eins', 'Active', 'g1@example.org', '1.1.2026'),
           ('30000000-0000-4000-8000-0000000000c2', $1, $3, '20000000-0000-4000-8000-0000000000c1', 'admin', 'Gamma Zwei', 'Active', 'g2@example.org', '1.1.2026')`,
        [gamma, gammaEins, ids.dora]
      );
      const a = '30000000-0000-4000-8000-0000000000c1';
      const b = '30000000-0000-4000-8000-0000000000c2';

      expect((await f.api('patch', `${m(gamma)}/${a}`, ids.dora, { role_id: '20000000-0000-4000-8000-0000000000c2' })).status).toBe(200);
      const letzter = await f.api('patch', `${m(gamma)}/${b}`, ids.dora, { role_id: '20000000-0000-4000-8000-0000000000c2' });
      expect(letzter.status).toBe(409);
      expect(letzter.body.code).toBe('last_admin');
      const loeschen = await f.api('delete', `${m(gamma)}/${b}`, ids.dora);
      expect(loeschen.status).toBe(409);
      expect(loeschen.body.code).toBe('last_admin');
    });
  });

  describe('Eigenes Profil (PATCH /members/me)', () => {
    it('ändert nur persönliche Angaben des eigenen Mitglieds', async () => {
      const antwort = await f.api('patch', `${m(ids.alpha)}/me`, ids.anna, { phone: '0171', city: 'Köln', birthday: '1991-02-03', contact_channels: { Discord: 'anna#1', WhatsApp: '+49' } });

      expect(antwort.status).toBe(200);
      expect(antwort.body).toMatchObject({ id: ids.annaMitglied, phone: '0171', city: 'Köln', contact_channels: { Discord: 'anna#1', WhatsApp: '+49' } });
      const andere = await f.admin.query('SELECT phone FROM members WHERE id = $1', [ids.paulMitglied]);
      expect(andere.rows[0].phone).toBeNull();
    });

    it('lehnt Rolle, Rechte, Name, E-Mail, Konto und Organisation im eigenen Profil ab', async () => {
      for (const feld of [{ app_role: 'admin' }, { role_id: ids.alphaAdminRolle }, { permissions: ['wiki:edit'] }, { name: 'Anderer' }, { email: 'neu@example.org' }, { user_id: ids.olga }, { organization_id: ids.beta }, { status: 'Inactive' }]) {
        expect((await f.api('patch', `${m(ids.alpha)}/me`, ids.anna, feld)).status, JSON.stringify(feld)).toBe(400);
      }
      const { rows } = await f.admin.query('SELECT app_role, role_id FROM members WHERE id = $1', [ids.annaMitglied]);
      expect(rows[0]).toEqual({ app_role: 'member', role_id: ids.alphaMitgliedRolle });
    });

    it('verlangt Anmeldung und Mitgliedschaft in der Organisation', async () => {
      expect((await f.api('patch', `${m(ids.alpha)}/me`, null, { phone: '1' })).status).toBe(401);
      expect((await f.api('patch', `${m(ids.alpha)}/me`, ids.bernd, { phone: '1' })).status).toBe(403);
    });
  });

  describe('Löschen', () => {
    it('löscht Mitglieder und verwaiste Konten, behält Konten mit weiteren Mitgliedschaften', async () => {
      // Einzelkonto nur in Alpha; Mehrfachkonto in Alpha und Beta.
      const einzel = '00000000-0000-4000-8000-0000000000e1';
      const mehrfach = '00000000-0000-4000-8000-0000000000e2';
      for (const [id, mail] of [[einzel, 'einzel@example.org'], [mehrfach, 'mehrfach@example.org']]) {
        await f.admin.query("INSERT INTO auth_users (id, email, password_hash, email_verified) VALUES ($1, $2, 'x', true)", [id, mail]);
      }
      const einzelMitglied = await neuesMitglied('einzel@example.org');
      const mehrfachAlpha = await neuesMitglied('mehrfach@example.org');
      const mehrfachBeta = await neuesMitglied('mehrfach@example.org', {}, ids.beta);
      await f.admin.query('UPDATE members SET user_id = $2 WHERE id = $1', [einzelMitglied, einzel]);
      await f.admin.query('UPDATE members SET user_id = $2 WHERE id = ANY($1::uuid[])', [[mehrfachAlpha, mehrfachBeta], mehrfach]);

      expect((await f.api('delete', `${m(ids.alpha)}/${einzelMitglied}`, ids.olga)).status).toBe(204);
      expect((await f.api('delete', `${m(ids.alpha)}/${mehrfachAlpha}`, ids.olga)).status).toBe(204);

      const konten = await f.admin.query('SELECT id FROM auth_users WHERE id = ANY($1::uuid[])', [[einzel, mehrfach]]);
      expect(konten.rows.map((r) => r.id)).toEqual([mehrfach]);
      const audit = await f.admin.query("SELECT count(*)::int AS n FROM audit_logs WHERE table_name = 'members' AND operation = 'DELETE'");
      expect(audit.rows[0].n).toBe(2);
    });

    it('löscht mehrere auf einmal oder gar nichts (fremde ID macht alles rückgängig)', async () => {
      const a = await neuesMitglied('bulk1@example.org');
      const b = await neuesMitglied('bulk2@example.org');

      const mitFremdem = await f.api('post', `${m(ids.alpha)}/bulk-delete`, ids.olga, { ids: [a, ids.berndMitglied] });
      expect(mitFremdem.status).toBe(404);
      expect((await f.admin.query('SELECT count(*)::int AS n FROM members WHERE id = $1', [a])).rows[0].n).toBe(1);

      expect((await f.api('post', `${m(ids.alpha)}/bulk-delete`, ids.olga, { ids: [a, b] })).status).toBe(204);
      expect((await f.admin.query('SELECT count(*)::int AS n FROM members WHERE id = ANY($1::uuid[])', [[a, b]])).rows[0].n).toBe(0);
      expect((await f.api('post', `${m(ids.alpha)}/bulk-delete`, ids.anna, { ids: [a] })).status).toBe(403);
      expect((await f.api('post', `${m(ids.alpha)}/bulk-delete`, ids.olga, { ids: [] })).status).toBe(400);
    });
  });

  describe('Einladung (POST /members/:id/invite)', () => {
    it('lädt ein Mitglied ohne Konto ein: Konto ohne Passwort, Einladungsmail an die gespeicherte Adresse, Verknüpfung', async () => {
      const id = await neuesMitglied('einladen@example.org');

      const antwort = await f.api('post', `${m(ids.alpha)}/${id}/invite`, ids.olga);

      expect(antwort.status).toBe(200);
      expect(antwort.body).toMatchObject({ type: 'invited', message: 'Invitation sent successfully' });
      expect(f.pgApp.mailer.sendInvitationEmail).toHaveBeenCalledTimes(1);
      const [an, , org] = f.pgApp.mailer.sendInvitationEmail.mock.calls[0] as string[];
      expect([an, org]).toEqual(['einladen@example.org', 'Alpha e. V.']);
      const verknuepft = await f.admin.query('SELECT user_id FROM members WHERE id = $1', [id]);
      expect(verknuepft.rows[0].user_id).toBe(antwort.body.userId);
      const konto = await f.admin.query('SELECT email_verified, password_set FROM auth_users WHERE id = $1', [antwort.body.userId]);
      expect(konto.rows[0]).toEqual({ email_verified: false, password_set: false });
    });

    it('sendet bestätigten Konten einen Passwort-Reset statt einer Einladung', async () => {
      const id = await neuesMitglied('dora@example.org'); // Dora hat ein bestätigtes Konto

      const antwort = await f.api('post', `${m(ids.alpha)}/${id}/invite`, ids.olga);

      expect(antwort.body).toMatchObject({ type: 'reset', userId: ids.dora, message: 'Passwort-Reset E-Mail gesendet' });
      expect(f.pgApp.mailer.sendPasswordResetEmail).toHaveBeenCalledTimes(1);
      expect(f.pgApp.mailer.sendInvitationEmail).not.toHaveBeenCalled();
    });

    it('verweigert Nicht-Administratoren und fremde Mitglieder', async () => {
      const id = await neuesMitglied('einladenverbot@example.org');
      expect((await f.api('post', `${m(ids.alpha)}/${id}/invite`, ids.anna)).status).toBe(403);
      expect((await f.api('post', `${m(ids.alpha)}/${id}/invite`, ids.clara)).status).toBe(403);
      expect((await f.api('post', `${m(ids.alpha)}/${ids.berndMitglied}/invite`, ids.olga)).status).toBe(404);
      expect(f.pgApp.mailer.sendInvitationEmail).not.toHaveBeenCalled();
    });

    it('sendet immer an die gespeicherte Adresse; eine im Body übergebene Adresse wird ignoriert', async () => {
      const id = await neuesMitglied('einladenfest@example.org');

      const antwort = await f.api('post', `${m(ids.alpha)}/${id}/invite`, ids.olga, { email: 'angreifer@example.org' });

      expect(antwort.status).toBe(200);
      expect((f.pgApp.mailer.sendInvitationEmail.mock.calls[0] as string[])[0]).toBe('einladenfest@example.org');
      const angreifer = await f.admin.query("SELECT count(*)::int AS n FROM auth_users WHERE email = 'angreifer@example.org'");
      expect(angreifer.rows[0].n).toBe(0);
    });
  });

  describe('Weitergabe-Link (POST /members/:id/magic-link)', () => {
    it('erlaubt Administratoren und Vorstand einen Link für Mitglieder ohne bestätigtes Konto', async () => {
      const id = await neuesMitglied('link@example.org');

      const antwort = await f.api('post', `${m(ids.alpha)}/${id}/magic-link`, ids.clara);

      expect(antwort.status).toBe(200);
      expect(antwort.body).toMatchObject({ success: true, expiresIn: '60 Minuten' });
      expect(antwort.body.link).toContain('/auth/callback?type=magic&token=');
      const token = antwort.body.link.split('token=')[1];
      const einloesung = await f.api('post', '/api/v1/auth/magic-link/consume', null, { token });
      expect(einloesung.status).toBe(200);
      const verknuepft = await f.admin.query('SELECT user_id FROM members WHERE id = $1', [id]);
      expect(verknuepft.rows[0].user_id).toBe(einloesung.body.userId);
    });

    it('verweigert normalen Mitgliedern den Link', async () => {
      const id = await neuesMitglied('linkverbot@example.org');
      expect((await f.api('post', `${m(ids.alpha)}/${id}/magic-link`, ids.anna)).status).toBe(403);
    });

    it('erzeugt keinen Login-Link für ein bestätigtes Konto (Kontoübernahme)', async () => {
      const id = await neuesMitglied('olga@example.org'); // Olgas bestätigtes Konto

      const antwort = await f.api('post', `${m(ids.alpha)}/${id}/magic-link`, ids.olga);

      expect(antwort.status).toBe(409);
      expect(antwort.body.code).toBe('account_exists');
      expect(JSON.stringify(antwort.body)).not.toContain('token=');
    });
  });

  describe('Rollen (POST/PATCH/DELETE /roles)', () => {
    it('legt eine Rolle an, nur durch Administratoren, mit gültigen Berechtigungen', async () => {
      const antwort = await f.api('post', `/api/v1/orgs/${ids.alpha}/roles`, ids.olga, { name: 'Redaktion', description: 'Schreibt', permissions: ['feed:create', 'wiki:edit'] });
      expect(antwort.status).toBe(201);
      expect(antwort.body).toMatchObject({ name: 'Redaktion', permissions: ['feed:create', 'wiki:edit'], is_system_admin: false, is_default: false, organization_id: ids.alpha });

      expect((await f.api('post', `/api/v1/orgs/${ids.alpha}/roles`, ids.anna, { name: 'X' })).status).toBe(403);
      expect((await f.api('post', `/api/v1/orgs/${ids.alpha}/roles`, ids.olga, { name: 'Y', permissions: ['alles:erlaubt'] })).status).toBe(400);
      expect((await f.api('post', `/api/v1/orgs/${ids.alpha}/roles`, ids.olga, { name: 'Redaktion' })).status).toBe(409);
      expect((await f.api('post', `/api/v1/orgs/${ids.alpha}/roles`, ids.olga, { name: 'Z', organization_id: ids.beta })).status).toBe(400);
    });

    it('hält höchstens eine Standardrolle je Organisation', async () => {
      const antwort = await f.api('post', `/api/v1/orgs/${ids.alpha}/roles`, ids.olga, { name: 'Neue Standardrolle', is_default: true });
      expect(antwort.status).toBe(201);
      const { rows } = await f.admin.query('SELECT name FROM organization_roles WHERE organization_id = $1 AND is_default', [ids.alpha]);
      expect(rows).toEqual([{ name: 'Neue Standardrolle' }]);
      await f.api('patch', `/api/v1/orgs/${ids.alpha}/roles/${ids.alphaMitgliedRolle}`, ids.olga, { is_default: true });
      const wieder = await f.admin.query('SELECT name FROM organization_roles WHERE organization_id = $1 AND is_default', [ids.alpha]);
      expect(wieder.rows).toEqual([{ name: 'Mitglied' }]);
    });

    it('ändert Rollen nur in der eigenen Organisation und entzieht dem Besitzer nie die Admin-Rolle', async () => {
      expect((await f.api('patch', `/api/v1/orgs/${ids.alpha}/roles/${ids.betaMitgliedRolle}`, ids.olga, { name: 'Gekapert' })).status).toBe(404);
      const entzug = await f.api('patch', `/api/v1/orgs/${ids.alpha}/roles/${ids.alphaAdminRolle}`, ids.olga, { is_system_admin: false });
      expect(entzug.status).toBe(409);
      expect(entzug.body.code).toBe('owner_protected');
      expect((await f.api('patch', `/api/v1/orgs/${ids.alpha}/roles/${ids.alphaMitgliedRolle}`, ids.anna, { name: 'Neu' })).status).toBe(403);
    });

    it('löscht eine Rolle und weist Betroffene der Standardrolle zu; Systemadministrator-Rollen bleiben', async () => {
      const rolle = (await f.api('post', `/api/v1/orgs/${ids.alpha}/roles`, ids.olga, { name: 'Temporär' })).body.id;
      const id = await neuesMitglied('rolleweg@example.org', { role_id: rolle });

      expect((await f.api('delete', `/api/v1/orgs/${ids.alpha}/roles/${rolle}`, ids.anna)).status).toBe(403);
      expect((await f.api('delete', `/api/v1/orgs/${ids.alpha}/roles/${rolle}`, ids.olga)).status).toBe(204);
      const { rows } = await f.admin.query('SELECT role_id FROM members WHERE id = $1', [id]);
      expect(rows[0].role_id).toBe(ids.alphaMitgliedRolle);

      const system = await f.api('delete', `/api/v1/orgs/${ids.alpha}/roles/${ids.alphaAdminRolle}`, ids.olga);
      expect(system.status).toBe(409);
      expect(system.body.code).toBe('system_role');
      expect((await f.api('delete', `/api/v1/orgs/${ids.alpha}/roles/${ids.betaMitgliedRolle}`, ids.olga)).status).toBe(404);
    });
  });
});
