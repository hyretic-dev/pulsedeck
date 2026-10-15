import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { Client } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { buildPgTestApp, type PgTestApp } from '../../test/pg-app';
import { createTestDatabase, dropTestDatabase } from '../../test/pg-test-db';

/**
 * Verknüpfung von Mitgliedern ohne Konto per E-Mail (Ersatz für den Bestands-Trigger
 * `handle_new_user_linking` auf auth.users), gegen echtes PostgreSQL und die echte HTTP-Kette.
 * Sicherheitsregel (Gesamtauftrag §5): nur bei bestätigter E-Mail; bereits verknüpfte Mitglieder
 * werden nie übernommen.
 */
describe('Mitglieder-Verknüpfung per bestätigter E-Mail (echtes PostgreSQL)', () => {
  const DB = 'pulsedeck_linking_test';
  const alpha = '10000000-0000-4000-8000-000000000001';
  const rolle = '20000000-0000-4000-8000-000000000002';
  const fremderNutzer = '00000000-0000-4000-8000-0000000000f1';
  const PASSWORT = 'sicheres-passwort';

  let app: INestApplication;
  let pgApp: PgTestApp;
  let admin: Client;
  let zaehler = 0;

  const server = () => app.getHttpServer();

  async function legeMitgliedAn(email: string, userId: string | null = null): Promise<string> {
    zaehler += 1;
    const memberId = `30000000-0000-4000-8000-${String(zaehler).padStart(12, '0')}`;
    await admin.query(
      `INSERT INTO members (id, organization_id, user_id, role_id, app_role, name, status, email, join_date)
       VALUES ($1, $2, $3, $4, 'member', $5, 'Active', $6, '2026-01-01')`,
      [memberId, alpha, userId, rolle, `Mitglied ${zaehler}`, email]
    );
    return memberId;
  }

  async function userIdDesMitglieds(memberId: string): Promise<string | null> {
    const { rows } = await admin.query<{ user_id: string | null }>('SELECT user_id FROM members WHERE id = $1', [memberId]);
    return rows[0].user_id;
  }

  /** Registrierung per HTTP; liefert den Token aus dem (gespionten) Verifikationslink. */
  async function registriere(email: string): Promise<string> {
    pgApp.mailer.sendVerificationEmail.mockClear();
    const antwort = await request(server()).post('/api/v1/auth/signup').send({ email, password: PASSWORT });
    expect(antwort.status).toBe(202);
    const [, link] = pgApp.mailer.sendVerificationEmail.mock.calls[0] as [string, string];
    return link.split('token=')[1];
  }

  async function bestaetige(token: string): Promise<{ accessToken: string; userId: string }> {
    const antwort = await request(server()).post('/api/v1/auth/verify-email').send({ token });
    expect(antwort.status).toBe(200);
    return antwort.body;
  }

  async function mitgliedschaften(accessToken: string): Promise<Array<{ member_id: string; organization_slug: string }>> {
    const antwort = await request(server()).get('/api/v1/me/memberships').set('Authorization', `Bearer ${accessToken}`);
    expect(antwort.status).toBe(200);
    return antwort.body;
  }

  beforeAll(async () => {
    const db = await createTestDatabase(DB);
    admin = new Client({ connectionString: db.adminUrl });
    await admin.connect();
    await admin.query(
      `INSERT INTO auth_users (id, email, password_hash, email_verified) VALUES ($1, 'fremd@example.org', 'x', true)`,
      [fremderNutzer]
    );
    await admin.query(`INSERT INTO organizations (id, slug, name) VALUES ($1, 'alpha', 'Alpha e. V.')`, [alpha]);
    await admin.query(
      `INSERT INTO organization_roles (id, organization_id, name, is_default) VALUES ($1, $2, 'Mitglied', true)`,
      [rolle, alpha]
    );
    pgApp = await buildPgTestApp(db.runtimeUrl);
    app = pgApp.app;
  });

  afterAll(async () => {
    await app?.close();
    await admin?.end();
    await dropTestDatabase(DB);
  });

  beforeEach(() => {
    pgApp.mailer.sendVerificationEmail.mockClear();
  });

  it('verknüpft nach der E-Mail-Bestätigung das Mitglied mit gleicher Adresse (egal in welcher Schreibweise)', async () => {
    const memberId = await legeMitgliedAn('Neu.Mitglied@Example.ORG');

    const session = await bestaetige(await registriere('neu.mitglied@example.org'));

    expect(await userIdDesMitglieds(memberId)).toBe(session.userId);
    expect((await mitgliedschaften(session.accessToken)).map((m) => m.member_id)).toEqual([memberId]);
  });

  it('verknüpft vor der Bestätigung nichts (E-Mail allein ohne geprüfte Identität übernimmt kein Mitglied)', async () => {
    const memberId = await legeMitgliedAn('ungeprueft@example.org');

    await registriere('ungeprueft@example.org'); // Registrierung ohne Klick auf den Link

    expect(await userIdDesMitglieds(memberId)).toBeNull();
  });

  it('übernimmt kein bereits verknüpftes Mitglied, auch nicht bei gleicher E-Mail-Adresse', async () => {
    const memberId = await legeMitgliedAn('belegt@example.org', fremderNutzer);

    const session = await bestaetige(await registriere('belegt@example.org'));

    expect(await userIdDesMitglieds(memberId)).toBe(fremderNutzer);
    expect(await mitgliedschaften(session.accessToken)).toEqual([]);
  });

  it('verknüpft ein erst später angelegtes Mitglied beim nächsten Login', async () => {
    const session = await bestaetige(await registriere('spaet@example.org'));
    expect(await mitgliedschaften(session.accessToken)).toEqual([]);
    const memberId = await legeMitgliedAn('spaet@example.org'); // z. B. nachträglich eingeladen

    const login = await request(server()).post('/api/v1/auth/login').send({ email: 'spaet@example.org', password: PASSWORT });

    expect(login.status).toBe(200);
    expect(await userIdDesMitglieds(memberId)).toBe(session.userId);
    expect((await mitgliedschaften(login.body.accessToken)).map((m) => m.member_id)).toEqual([memberId]);
  });

  it('verknüpft auch beim Einlösen eines Magic-Links (Postfach-Nachweis)', async () => {
    const session = await bestaetige(await registriere('magisch@example.org'));
    const memberId = await legeMitgliedAn('magisch@example.org');
    pgApp.mailer.sendMagicLinkEmail.mockClear();
    await request(server()).post('/api/v1/auth/magic-link').send({ email: 'magisch@example.org' }).expect(202);
    const [, link] = pgApp.mailer.sendMagicLinkEmail.mock.calls[0] as [string, string];

    const antwort = await request(server()).post('/api/v1/auth/magic-link/consume').send({ token: link.split('token=')[1] });

    expect(antwort.status).toBe(200);
    expect(await userIdDesMitglieds(memberId)).toBe(session.userId);
  });

  it('legt keine zweite Mitgliedschaft in derselben Organisation an (übersprungen statt Fehler beim Login)', async () => {
    const session = await bestaetige(await registriere('doppelt@example.org'));
    // Das Konto ist in Alpha schon unter einer anderen Adresse Mitglied ...
    const vorhandenes = await legeMitgliedAn('andere-adresse@example.org', session.userId);
    // ... und ein weiteres, noch freies Mitglied trägt die Kontoadresse.
    const freies = await legeMitgliedAn('doppelt@example.org');

    const login = await request(server()).post('/api/v1/auth/login').send({ email: 'doppelt@example.org', password: PASSWORT });

    expect(login.status).toBe(200); // der Unique-Index führt nicht zu einem Fehler im Login
    expect(await userIdDesMitglieds(freies)).toBeNull();
    expect((await mitgliedschaften(login.body.accessToken)).map((m) => m.member_id)).toEqual([vorhandenes]);
  });
});
