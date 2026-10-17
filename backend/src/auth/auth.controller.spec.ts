import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type { AuthUser } from './auth-user.repository';
import { buildTestApp, type TestApp } from '../../test/integration-app';

/**
 * Schritt B: HTTP-Fehlervertrag und Auth-Endpunkte über supertest
 * (Nest-App mit In-Memory-Ports).
 * - Happy Paths, 400 bei invaliden DTOs, 401 ohne/falschem Token,
 *   429 bei Rate-Limit, Enumeration-Gleichheit unbekannt/bekannt.
 */
describe('AuthController /api/v1/auth (Integrationstest)', () => {
  const nutzer: AuthUser = {
    id: 'user-1',
    email: 'vorstand@example.org',
    passwordHash: 'hash(passwort123)',
    emailVerified: true,
    isBlocked: false,
  };

  let testApp: TestApp;

  beforeAll(async () => {
    testApp = await buildTestApp();
    await testApp.app.init();
  });

  afterAll(async () => {
    await testApp.app.close();
  });

  beforeEach(() => {
    testApp.ports.users.anlegen(nutzer);
    vi.mocked(testApp.ports.mailer.sendVerificationEmail).mockClear();
    vi.mocked(testApp.ports.mailer.sendMagicLinkEmail).mockClear();
    vi.mocked(testApp.ports.mailer.sendPasswordResetEmail).mockClear();
  });

  async function login(): Promise<{ userId: string; accessToken: string; refreshToken: string }> {
    const antwort = await request(testApp.app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: nutzer.email, password: 'passwort123' });
    expect(antwort.status).toBe(200);
    return antwort.body;
  }

  it('liefert beim Login eine Session mit Access- und Refresh-Token', async () => {
    const sitzung = await login();

    expect(sitzung.userId).toBe(nutzer.id);
    expect(typeof sitzung.accessToken).toBe('string');
    expect(typeof sitzung.refreshToken).toBe('string');
  });

  it('antwortet bei falschen Credentials mit 401 und dem Fehlervertrag { code, message }', async () => {
    const antwort = await request(testApp.app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: nutzer.email, password: 'falsch' });

    expect(antwort.status).toBe(401);
    expect(antwort.body).toEqual({
      code: 'invalid_credentials',
      message: 'E-Mail oder Passwort ist falsch',
    });
  });

  it('lehnt unvollständige/ungültige DTOs mit 400 validation_failed ab', async () => {
    const antwort = await request(testApp.app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: 'keine-mail', password: '' });

    expect(antwort.status).toBe(400);
    expect(antwort.body.code).toBe('validation_failed');
    expect(typeof antwort.body.message).toBe('string');
  });

  it('lehnt unbekannte Felder im Body ab (kein Parameter-Schmuggel)', async () => {
    const antwort = await request(testApp.app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: nutzer.email, password: 'passwort123', is_blocked: false });

    expect(antwort.status).toBe(400);
    expect(antwort.body.code).toBe('validation_failed');
  });

  it('verweigert geschützte Endpunkte ohne Token mit 401', async () => {
    const antwort = await request(testApp.app.getHttpServer())
      .post('/api/v1/auth/change-password')
      .send({ oldPassword: 'passwort123', newPassword: 'neues-passwort-456' });

    expect(antwort.status).toBe(401);
    expect(antwort.body).toEqual({ code: 'unauthorized', message: 'Nicht authentifiziert' });
  });

  it('verweigert geschützte Endpunkte mit ungültigem Token mit 401', async () => {
    const antwort = await request(testApp.app.getHttpServer())
      .post('/api/v1/auth/change-password')
      .set('Authorization', 'Bearer kein-gueltiges-jwt')
      .send({ oldPassword: 'passwort123', newPassword: 'neues-passwort-456' });

    expect(antwort.status).toBe(401);
  });

  it('verweigert den Login für gesperrte Konten mit 403 account_blocked', async () => {
    testApp.ports.users.anlegen({ ...nutzer, id: 'user-blocked', email: 'blockiert@example.org', isBlocked: true });

    const antwort = await request(testApp.app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: 'blockiert@example.org', password: 'passwort123' });

    expect(antwort.status).toBe(403);
    expect(antwort.body).toEqual({
      code: 'account_blocked',
      message: 'Dieses Konto ist gesperrt',
    });
  });

  it('ändert das Passwort mit gültigem Bearer-Token und widerruft alte Sessions', async () => {
    const sitzung = await login();

    const antwort = await request(testApp.app.getHttpServer())
      .post('/api/v1/auth/change-password')
      .set('Authorization', `Bearer ${sitzung.accessToken}`)
      .send({ oldPassword: 'passwort123', newPassword: 'neues-passwort-456' });

    expect(antwort.status).toBe(200);
    expect(antwort.body.userId).toBe(nutzer.id);
    // Alter Refresh-Token ist ungültig.
    const refresh = await request(testApp.app.getHttpServer())
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: sitzung.refreshToken });
    expect(refresh.status).toBe(401);
  });

  it('erzeugt bei Signup eine Verifikations-Mail und antwortet generisch', async () => {
    const antwort = await request(testApp.app.getHttpServer())
      .post('/api/v1/auth/signup')
      .send({ email: 'neu@example.org', password: 'sicher1234' });

    expect(antwort.status).toBe(202);
    expect(antwort.body).toEqual({});
    expect(testApp.ports.mailer.sendVerificationEmail).toHaveBeenCalledTimes(1);
  });

  it('antwortet bei Signup mit bereits vorhandener E-Mail identisch (keine Enumeration)', async () => {
    const antwort = await request(testApp.app.getHttpServer())
      .post('/api/v1/auth/signup')
      .send({ email: nutzer.email, password: 'sicher1234' });

    expect(antwort.status).toBe(202);
    expect(antwort.body).toEqual({});
    expect(testApp.ports.mailer.sendVerificationEmail).not.toHaveBeenCalled();
  });

  it('antwortet Magic-Link-Anforderung für unbekannte und bekannte E-Mail identisch', async () => {
    const bekannt = await request(testApp.app.getHttpServer())
      .post('/api/v1/auth/magic-link')
      .send({ email: nutzer.email });
    const unbekannt = await request(testApp.app.getHttpServer())
      .post('/api/v1/auth/magic-link')
      .send({ email: 'unbekannt@example.org' });

    expect(bekannt.status).toBe(202);
    expect(unbekannt.status).toBe(202);
    expect(bekannt.body).toEqual(unbekannt.body);
  });

  it('lehnt nach Überschreiten des Mail-Limits mit 429 ab, unabhängig davon, ob die E-Mail existiert', async () => {
    testApp.ports.users.anlegen({
      ...nutzer,
      id: 'user-limit',
      email: 'limit-bekannt@example.org',
    });
    const signup = (email: string) =>
      request(testApp.app.getHttpServer())
        .post('/api/v1/auth/signup')
        .send({ email, password: 'sicher1234' });

    // Limit 3 pro Stunde und E-Mail+IP: die ersten drei Anfragen laufen durch.
    for (let i = 0; i < 3; i++) {
      expect((await signup('limit-bekannt@example.org')).status).toBe(202);
      expect((await signup('limit-unbekannt@example.org')).status).toBe(202);
    }

    const bekannt = await signup('limit-bekannt@example.org');
    const unbekannt = await signup('limit-unbekannt@example.org');

    expect(bekannt.status).toBe(429);
    expect(unbekannt.status).toBe(429);
    expect(bekannt.body).toEqual({
      code: 'rate_limited',
      message: 'Zu viele Anfragen. Bitte später erneut versuchen.',
    });
    expect(unbekannt.body).toEqual(bekannt.body);
  });

  it('rotiert beim Refresh den Token und meldet ungültige Tokens mit 401', async () => {
    const sitzung = await login();

    const refresh = await request(testApp.app.getHttpServer())
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: sitzung.refreshToken });

    expect(refresh.status).toBe(200);
    expect(refresh.body.refreshToken).not.toBe(sitzung.refreshToken);

    const nochmal = await request(testApp.app.getHttpServer())
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: sitzung.refreshToken });
    expect(nochmal.status).toBe(401);
    expect(nochmal.body).toEqual({
      code: 'session_invalid',
      message: 'Sitzung ungültig oder abgelaufen',
    });
  });

  it('meldet Logout 204 und widerruft die Session', async () => {
    const sitzung = await login();

    const logout = await request(testApp.app.getHttpServer())
      .post('/api/v1/auth/logout')
      .set('Authorization', `Bearer ${sitzung.accessToken}`)
      .send({ refreshToken: sitzung.refreshToken });
    expect(logout.status).toBe(204);

    const refresh = await request(testApp.app.getHttpServer())
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: sitzung.refreshToken });
    expect(refresh.status).toBe(401);
  });

  it('meldet verify-email für ungültige Tokens 401 link_invalid', async () => {
    const antwort = await request(testApp.app.getHttpServer())
      .post('/api/v1/auth/verify-email')
      .send({ token: 'ungueltig' });

    expect(antwort.status).toBe(401);
    expect(antwort.body).toEqual({
      code: 'link_invalid',
      message: 'Link ungültig oder abgelaufen',
    });
  });
});
