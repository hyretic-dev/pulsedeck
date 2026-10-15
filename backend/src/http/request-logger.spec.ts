import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { buildTestApp, type TestApp } from '../../test/integration-app';

/**
 * Strukturiertes Zugriffslog mit Request-ID (Gesamtauftrag §13): eine JSON-Zeile je Anfrage,
 * Korrelation über X-Request-Id, keine Query-Strings, keine Header, keine Bodies, keine Secrets.
 */
describe('Zugriffslog und Request-ID', () => {
  let testApp: TestApp;

  beforeAll(async () => {
    testApp = await buildTestApp();
    testApp.ports.users.anlegen({
      id: 'user-log',
      email: 'log@example.org',
      passwordHash: 'hash(passwort123)',
      emailVerified: true,
      isBlocked: false,
    });
    await testApp.app.init();
  });

  afterAll(async () => {
    await testApp.app.close();
  });

  function letzteZeile(): Record<string, unknown> {
    return JSON.parse(testApp.accessLog[testApp.accessLog.length - 1]);
  }

  it('vergibt eine Request-ID, liefert sie im Header zurück und loggt sie als JSON-Zeile', async () => {
    const antwort = await request(testApp.app.getHttpServer()).get('/health/liveness');

    const id = antwort.headers['x-request-id'];
    expect(id).toMatch(/^[0-9a-f-]{36}$/);
    expect(letzteZeile()).toMatchObject({
      msg: 'http_request',
      requestId: id,
      method: 'GET',
      path: '/health/liveness',
      status: 200,
    });
    expect(typeof letzteZeile().durationMs).toBe('number');
    expect(typeof letzteZeile().time).toBe('string');
  });

  it('übernimmt eine gültige X-Request-Id des Proxys und ersetzt eine ungültige', async () => {
    const gueltig = await request(testApp.app.getHttpServer()).get('/health/liveness').set('X-Request-Id', 'abc123DEF-456_xyz');
    expect(gueltig.headers['x-request-id']).toBe('abc123DEF-456_xyz');

    const ungueltig = await request(testApp.app.getHttpServer())
      .get('/health/liveness')
      .set('X-Request-Id', 'injiziert: {"level":"error"} !!');
    expect(ungueltig.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
    expect(JSON.stringify(letzteZeile())).not.toContain('injiziert');
  });

  it('loggt weder Query-String noch Header, Body oder Passwörter', async () => {
    const bearer = 'Bearer geheimes-token-xyz';
    await request(testApp.app.getHttpServer())
      .post('/api/v1/auth/login?token=query-geheimnis&redirect=https://boese.example')
      .set('Authorization', bearer)
      .set('Cookie', 'sitzung=cookie-geheimnis')
      .send({ email: 'log@example.org', password: 'passwort-geheimnis' });

    const zeile = testApp.accessLog[testApp.accessLog.length - 1];
    expect(zeile).not.toContain('query-geheimnis');
    expect(zeile).not.toContain('boese.example');
    expect(zeile).not.toContain('geheimes-token-xyz');
    expect(zeile).not.toContain('cookie-geheimnis');
    expect(zeile).not.toContain('passwort-geheimnis');
    expect(zeile).not.toContain('log@example.org');
    expect(letzteZeile()).toMatchObject({ method: 'POST', path: '/api/v1/auth/login' });
  });

  it('nimmt die Konto-ID aus dem verifizierten Token auf (nie aus Client-Feldern)', async () => {
    const { TokenService } = await import('../auth/token.service');
    const token = await new TokenService({
      secret: new TextEncoder().encode('test-secret-test-secret-test-secret-1234'),
      issuer: 'pulsedeck-test',
      audience: 'pulsedeck-app',
      accessTtlSeconds: 900,
    }).signAccessToken('user-log');

    await request(testApp.app.getHttpServer())
      .get('/api/v1/me/memberships?userId=jemand-anderes')
      .set('Authorization', `Bearer ${token}`)
      .set('X-User-Id', 'jemand-anderes');

    expect(letzteZeile()).toMatchObject({ userId: 'user-log', status: 200 });
  });
});
