import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { buildTestApp, type TestApp } from '../test/integration-app';

/** Contract-Test: generierte OpenAPI muss die implementierten Pfade/Methoden enthalten. */
describe('OpenAPI unter /api/docs (Contract-Test)', () => {
  let testApp: TestApp;

  beforeAll(async () => {
    testApp = await buildTestApp();
    await testApp.app.init();
  });

  afterAll(async () => {
    await testApp.app.close();
  });

  /** Alle vom Router bedienten Routen als „METHODE /pfad/{param}“ (Swagger-UI und Docs-JSON ausgenommen). */
  function implementierteRouten(): string[] {
    const router = testApp.app.getHttpAdapter().getInstance().router as {
      stack: Array<{ route?: { path: string; methods: Record<string, boolean> } }>;
    };
    const routen = new Set<string>();
    for (const schicht of router.stack) {
      if (!schicht.route || schicht.route.path.startsWith('/api/docs')) continue;
      for (const methode of Object.keys(schicht.route.methods)) {
        if (methode === '_all' || methode === 'head' || methode === 'options') continue;
        routen.add(`${methode.toUpperCase()} ${schicht.route.path.replace(/:(\w+)/g, '{$1}')}`);
      }
    }
    return [...routen].sort();
  }

  it('dokumentiert genau die implementierten Routen (Pfad und Methode), nicht mehr und nicht weniger', async () => {
    const antwort = await request(testApp.app.getHttpServer()).get('/api/docs-json');

    expect(antwort.status).toBe(200);
    const pfade: Record<string, Record<string, unknown>> = antwort.body.paths;
    const dokumentiert = Object.entries(pfade)
      .flatMap(([pfad, methoden]) => Object.keys(methoden).map((m) => `${m.toUpperCase()} ${pfad}`))
      .sort();

    expect(dokumentiert).toEqual(implementierteRouten());
    // Stichprobe: die Kern-Endpunkte sind enthalten (schützt vor einer leeren Router-Auswertung).
    expect(dokumentiert).toEqual(
      expect.arrayContaining(['POST /api/v1/auth/login', 'GET /api/v1/me/memberships', 'POST /api/v1/orgs', 'GET /health/liveness'])
    );
  });

  it('liefert OpenAPI nur unter exakt kleingeschriebenem Pfad (Proxy-Block darf nicht per Schreibweise umgehbar sein)', async () => {
    // Regression aus dem Abgleich-Audit: Express routet standardmäßig case-insensitive,
    // der Reverse Proxy blockt aber nur `/api/docs*` — `/api/DOCS-json` war extern lesbar.
    const server = testApp.app.getHttpServer();

    for (const pfad of ['/api/DOCS-json', '/api/Docs-json', '/api/DOCS', '/api/Docs']) {
      const antwort = await request(server).get(pfad);
      expect(antwort.status, `${pfad} darf nicht ausgeliefert werden`).toBe(404);
    }
    expect((await request(server).get('/api/docs-json')).status).toBe(200);
  });

  it('dokumentiert Bearer-Auth als einziges Transportschema (O2: keine Cookies)', async () => {
    const antwort = await request(testApp.app.getHttpServer()).get('/api/docs-json');

    expect(Object.keys(antwort.body.components.securitySchemes)).toEqual(['bearer']);
  });

  it('dokumentiert die Session-Antwort für Login (DTO/Implementierung deckungsgleich)', async () => {
    const antwort = await request(testApp.app.getHttpServer()).get('/api/docs-json');

    const antwort200 = antwort.body.paths['/api/v1/auth/login'].post.responses['200'];
    expect(antwort200.content['application/json'].schema.$ref).toBe(
      '#/components/schemas/AuthSessionResponseDto'
    );
  });
});
