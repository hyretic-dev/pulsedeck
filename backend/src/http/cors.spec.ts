import request from 'supertest';
import { afterAll, describe, expect, it } from 'vitest';

import { loadAppConfig } from '../config/configuration';
import { buildTestApp, type TestApp } from '../../test/integration-app';

/**
 * Native Apps (Capacitor) laden die Oberfläche von einem eigenen Ursprung (`https://localhost`, `capacitor://localhost`)
 * und rufen die API per absoluter Adresse auf. Ohne Freigabe blockt der Browser die Antworten. Standard: keine
 * Fremdursprünge; erlaubt wird nur, was `CORS_ORIGINS` ausdrücklich nennt.
 */
describe('CORS für native Apps', () => {
  const apps: TestApp[] = [];
  afterAll(async () => {
    for (const a of apps) await a.app.close();
  });

  async function app(corsOrigins: string[]): Promise<TestApp> {
    const t = await buildTestApp({ corsOrigins });
    await t.app.init();
    apps.push(t);
    return t;
  }

  it('ohne Konfiguration setzt das Backend keine CORS-Header (nur gleicher Ursprung)', async () => {
    const t = await app([]);
    const antwort = await request(t.app.getHttpServer()).options('/api/v1/auth/login').set('Origin', 'capacitor://localhost').set('Access-Control-Request-Method', 'POST');
    expect(antwort.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('beantwortet den Preflight für einen freigegebenen Ursprung mit genau den nötigen Headern', async () => {
    const t = await app(['capacitor://localhost', 'https://localhost']);
    const antwort = await request(t.app.getHttpServer())
      .options('/api/v1/auth/login')
      .set('Origin', 'capacitor://localhost')
      .set('Access-Control-Request-Method', 'POST')
      .set('Access-Control-Request-Headers', 'authorization,content-type');
    expect(antwort.status).toBe(204);
    expect(antwort.headers['access-control-allow-origin']).toBe('capacitor://localhost');
    expect(antwort.headers['access-control-allow-headers'].toLowerCase()).toContain('authorization');
    expect(antwort.headers['access-control-allow-methods']).toContain('PATCH');
    expect(antwort.headers['access-control-allow-credentials']).toBeUndefined(); // Bearer, keine Cookies (O2)
    expect(antwort.headers.vary).toContain('Origin');
  });

  it('gibt Antwort-Header frei, die die Oberfläche liest, und lässt fremde Ursprünge ohne Freigabe', async () => {
    const t = await app(['https://localhost']);
    const erlaubt = await request(t.app.getHttpServer()).get('/health/liveness').set('Origin', 'https://localhost');
    expect(erlaubt.headers['access-control-allow-origin']).toBe('https://localhost');
    expect(erlaubt.headers['access-control-expose-headers']).toMatch(/x-request-id/i);
    expect(erlaubt.headers['access-control-expose-headers']).toMatch(/x-chat-session-id/i);

    const fremd = await request(t.app.getHttpServer()).get('/health/liveness').set('Origin', 'https://evil.example');
    expect(fremd.headers['access-control-allow-origin']).toBeUndefined();
    const praefix = await request(t.app.getHttpServer()).options('/api/v1/auth/login').set('Origin', 'https://localhost.evil.example').set('Access-Control-Request-Method', 'POST');
    expect(praefix.headers['access-control-allow-origin']).toBeUndefined();
  });
});

describe('CORS_ORIGINS in der Konfiguration', () => {
  const basis = {
    JWT_SECRET: 'a'.repeat(64),
    JWT_ISSUER: 'x',
    JWT_AUDIENCE: 'y',
    APP_BASE_URL: 'https://app.example.org',
    DATABASE_URL: 'postgres://u:p@h:5432/d',
    MAIL_TRANSPORT: 'log',
  };

  it('liest eine Liste exakter Ursprünge', () => {
    expect(loadAppConfig({ ...basis, CORS_ORIGINS: 'capacitor://localhost, https://localhost' }).corsOrigins).toEqual(['capacitor://localhost', 'https://localhost']);
    expect(loadAppConfig(basis).corsOrigins).toEqual([]);
  });

  it('lehnt Platzhalter und Angaben mit Pfad ab', () => {
    for (const falsch of ['*', 'https://localhost/', 'localhost', 'https://localhost/app', 'https://*.example.org']) {
      expect(() => loadAppConfig({ ...basis, CORS_ORIGINS: falsch }), falsch).toThrow(/CORS_ORIGINS/);
    }
  });
});
