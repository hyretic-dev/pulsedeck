import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { AuthUser } from './auth-user.repository';
import { buildTestApp, type TestApp } from '../../test/integration-app';

/**
 * Regressionen aus dem Folge-Audit zu E14 und Kontoenumeration:
 * - E-Mail-Adressen werden vor Rate-Limit und Verarbeitung normalisiert (die Datenbank ist
 *   case-insensitiv; ohne Normalisierung ließ sich das Login-Limit durch wechselnde
 *   Schreibweise umgehen).
 * - Die Endpunkte, die nur für bekannte Konten zusätzliche Arbeit leisten (Signup,
 *   Magic-Link, Reset), antworten nie schneller als eine Mindestdauer: Die Antwortzeit
 *   verrät so nicht, ob ein Konto existiert.
 */
describe('AuthController: Normalisierung und Mindestdauer', () => {
  const MIN_MS = 120;
  const bekannt: AuthUser = {
    id: 'user-1',
    email: 'vorstand@example.org',
    passwordHash: 'hash(passwort123)',
    emailVerified: true,
    isBlocked: false,
  };

  let testApp: TestApp;

  beforeAll(async () => {
    testApp = await buildTestApp({ minResponseMs: MIN_MS });
    testApp.ports.users.anlegen(bekannt);
    await testApp.app.init();
  });

  afterAll(async () => {
    await testApp.app.close();
  });

  it('zählt Login-Versuche unabhängig von der Schreibweise der E-Mail gegen dasselbe Limit', async () => {
    const server = testApp.app.getHttpServer();
    const schreibweisen = [
      'limit@example.org',
      'LIMIT@example.org',
      'Limit@Example.org',
      'lImIt@example.org',
      'limIT@EXAMPLE.org',
    ];

    for (const email of schreibweisen) {
      const antwort = await request(server).post('/api/v1/auth/login').send({ email, password: 'x' });
      expect(antwort.status).toBe(401);
    }
    const sechster = await request(server)
      .post('/api/v1/auth/login')
      .send({ email: 'LiMiT@example.org', password: 'x' });

    expect(sechster.status).toBe(429);
  });

  it('normalisiert E-Mail-Adressen (Leerraum, Großbuchstaben) vor der Verarbeitung', async () => {
    const antwort = await request(testApp.app.getHttpServer())
      .post('/api/v1/auth/signup')
      .send({ email: '  Neu.Person@Example.ORG ', password: 'sicheres-passwort' });

    expect(antwort.status).toBe(202);
    expect(await testApp.ports.users.findByEmail('neu.person@example.org')).not.toBeNull();
  });

  it('meldet sich mit abweichender Schreibweise am bekannten Konto an', async () => {
    const antwort = await request(testApp.app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: 'VORSTAND@Example.org', password: 'passwort123' });

    expect(antwort.status).toBe(200);
  });

  it.each([
    ['signup', { password: 'sicheres-passwort' }],
    ['magic-link', {}],
    ['password-reset', {}],
  ])(
    '%s antwortet für bekannte und unbekannte E-Mails nie schneller als die Mindestdauer',
    async (pfad, zusatz) => {
      const server = testApp.app.getHttpServer();
      for (const email of ['vorstand@example.org', `unbekannt-${pfad}@example.org`]) {
        const start = performance.now();
        const antwort = await request(server).post(`/api/v1/auth/${pfad}`).send({ email, ...zusatz });
        const dauer = performance.now() - start;

        expect(antwort.status).toBe(202);
        expect(dauer, `${pfad} ${email}`).toBeGreaterThanOrEqual(MIN_MS - 5);
      }
    }
  );
});
