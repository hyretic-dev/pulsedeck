import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { erstelleFixture, type Fixture } from '../../test/fixture';

/**
 * Einladungsabläufe gegen echtes PostgreSQL (Ersatz von send-invitation): E-Mail-Prüfung der
 * Login-Seite, Einladung ohne Passwort, erstes Passwort, Bestandskonto. Die Antwort der Prüfung
 * nennt weder Namen noch Organisationen (der Bestand lieferte beides an jeden Anonymen).
 */
describe('Einladung und E-Mail-Prüfung (echtes PostgreSQL)', () => {
  let f: Fixture;

  beforeAll(async () => {
    f = await erstelleFixture('pulsedeck_invitations_test');
  });
  afterAll(async () => {
    await f.schliessen();
  });
  beforeEach(() => {
    f.pgApp.mailer.sendInvitationEmail.mockClear();
    f.pgApp.mailer.sendPasswordResetEmail.mockClear();
  });

  async function legeMitgliedAn(email: string, org = f.ids.alpha, rolle = f.ids.alphaMitgliedRolle): Promise<string> {
    const { rows } = await f.admin.query(
      `INSERT INTO members (organization_id, role_id, name, status, email, join_date)
       VALUES ($1, $2, 'Eingeladen', 'Active', $3, '01.01.2026') RETURNING id`,
      [org, rolle, email]
    );
    return rows[0].id;
  }

  const tokenAusLink = (link: string) => link.split('token=')[1];

  it('meldet not_found, wenn es kein Mitglied mit der Adresse gibt (und sendet nichts)', async () => {
    const antwort = await f.api('post', '/api/v1/auth/check-email', null, { email: 'niemand@example.org' });

    expect(antwort.status).toBe(200);
    expect(antwort.body).toEqual({ status: 'not_found' });
    expect(f.pgApp.mailer.sendInvitationEmail).not.toHaveBeenCalled();
    const { rows } = await f.admin.query("SELECT count(*)::int AS n FROM auth_users WHERE email = 'niemand@example.org'");
    expect(rows[0].n).toBe(0);
  });

  it('lädt ein Mitglied ohne Konto ein: Konto ohne Passwort, Einladungsmail, nur Status in der Antwort', async () => {
    const memberId = await legeMitgliedAn('neu@example.org');

    const antwort = await f.api('post', '/api/v1/auth/check-email', null, { email: 'Neu@Example.org ' });

    expect(antwort.body).toEqual({ status: 'invitation_sent' });
    expect(f.pgApp.mailer.sendInvitationEmail).toHaveBeenCalledTimes(1);
    const [an, link, orgName] = f.pgApp.mailer.sendInvitationEmail.mock.calls[0] as [string, string, string];
    expect([an, orgName]).toEqual(['neu@example.org', 'Alpha e. V.']);
    expect(link).toContain('/auth/callback?type=magic&token=');
    const konto = await f.admin.query("SELECT email_verified, password_set FROM auth_users WHERE email = 'neu@example.org'");
    expect(konto.rows).toEqual([{ email_verified: false, password_set: false }]);

    // Der Link meldet passwortlos an, bestätigt die E-Mail und verknüpft das Mitglied.
    const einloesung = await f.api('post', '/api/v1/auth/magic-link/consume', null, { token: tokenAusLink(link) });
    expect(einloesung.status).toBe(200);
    const verknuepft = await f.admin.query('SELECT user_id FROM members WHERE id = $1', [memberId]);
    expect(verknuepft.rows[0].user_id).toBe(einloesung.body.userId);
    const ich = await f.api('get', '/api/v1/auth/me', null).set('Authorization', `Bearer ${einloesung.body.accessToken}`);
    expect(ich.body).toEqual({ userId: einloesung.body.userId, email: 'neu@example.org', emailVerified: true, hasPassword: false, isPlatformAdmin: false });
  });

  it('erlaubt das erste Passwort genau einmal; danach nur noch „Passwort ändern“', async () => {
    await legeMitgliedAn('passwort@example.org');
    await f.api('post', '/api/v1/auth/check-email', null, { email: 'passwort@example.org' });
    const [, link] = f.pgApp.mailer.sendInvitationEmail.mock.calls[0] as [string, string];
    const sitzung = (await f.api('post', '/api/v1/auth/magic-link/consume', null, { token: tokenAusLink(link) })).body;
    const bearer = { Authorization: `Bearer ${sitzung.accessToken}` };
    const mitToken = (methode: 'get' | 'post', pfad: string, body?: object) => {
      const anfrage = f.api(methode, pfad, null, body).set(bearer);
      return anfrage;
    };

    expect((await mitToken('post', '/api/v1/auth/set-password', { newPassword: 'kurz' })).status).toBe(400);
    const gesetzt = await mitToken('post', '/api/v1/auth/set-password', { newPassword: 'mein-neues-passwort' });
    expect(gesetzt.status).toBe(200);
    expect(typeof gesetzt.body.accessToken).toBe('string');
    expect((await f.api('post', '/api/v1/auth/login', null, { email: 'passwort@example.org', password: 'mein-neues-passwort' })).status).toBe(200);

    const nochmal = await f.api('post', '/api/v1/auth/set-password', null, { newPassword: 'noch-ein-passwort' }).set('Authorization', `Bearer ${gesetzt.body.accessToken}`);
    expect(nochmal.status).toBe(409);
    expect(nochmal.body.code).toBe('password_exists');
    expect((await f.api('post', '/api/v1/auth/set-password', null, { newPassword: 'mein-neues-passwort' })).status).toBe(401);
  });

  it('meldet connected für ein bestätigtes Konto und verknüpft dabei offene Mitglieder', async () => {
    const memberId = await legeMitgliedAn('dora@example.org'); // Doras bestätigtes Konto existiert

    const antwort = await f.api('post', '/api/v1/auth/check-email', null, { email: 'dora@example.org' });

    expect(antwort.body).toEqual({ status: 'connected' });
    expect(f.pgApp.mailer.sendInvitationEmail).not.toHaveBeenCalled();
    const { rows } = await f.admin.query('SELECT user_id FROM members WHERE id = $1', [memberId]);
    expect(rows[0].user_id).toBe(f.ids.dora);
  });

  it('grenzt auf die angegebene Organisation ein', async () => {
    await legeMitgliedAn('nurbeta@example.org', f.ids.beta, f.ids.betaMitgliedRolle);

    const falsch = await f.api('post', '/api/v1/auth/check-email', null, { email: 'nurbeta@example.org', organization_id: f.ids.alpha });
    const richtig = await f.api('post', '/api/v1/auth/check-email', null, { email: 'nurbeta@example.org', organization_id: f.ids.beta });

    expect(falsch.body.status).toBe('not_found');
    expect(richtig.body.status).toBe('invitation_sent');
    expect((f.pgApp.mailer.sendInvitationEmail.mock.calls[0] as string[])[2]).toBe('Beta e. V.');
  });

  it('sendet bei erneuter Prüfung eine frische Einladung und entwertet die alte', async () => {
    await legeMitgliedAn('zweimal@example.org');
    await f.api('post', '/api/v1/auth/check-email', null, { email: 'zweimal@example.org' });
    const [, alterLink] = f.pgApp.mailer.sendInvitationEmail.mock.calls[0] as [string, string];

    await f.api('post', '/api/v1/auth/check-email', null, { email: 'zweimal@example.org' });
    const [, neuerLink] = f.pgApp.mailer.sendInvitationEmail.mock.calls[1] as [string, string];

    expect(tokenAusLink(neuerLink)).not.toBe(tokenAusLink(alterLink));
    expect((await f.api('post', '/api/v1/auth/magic-link/consume', null, { token: tokenAusLink(alterLink) })).status).toBe(401);
    expect((await f.api('post', '/api/v1/auth/magic-link/consume', null, { token: tokenAusLink(neuerLink) })).status).toBe(200);
    const { rows } = await f.admin.query("SELECT count(*)::int AS n FROM auth_users WHERE email = 'zweimal@example.org'");
    expect(rows[0].n).toBe(1); // dasselbe Konto, kein zweites
  });

  it('prüft die Eingabe (E-Mail, UUID, unbekannte Felder)', async () => {
    expect((await f.api('post', '/api/v1/auth/check-email', null, { email: 'kaputt' })).status).toBe(400);
    expect((await f.api('post', '/api/v1/auth/check-email', null, { email: 'a@example.org', organization_id: 'keine-uuid' })).status).toBe(400);
    expect((await f.api('post', '/api/v1/auth/check-email', null, { email: 'a@example.org', admin: true })).status).toBe(400);
  });
});
