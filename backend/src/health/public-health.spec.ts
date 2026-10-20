import { ServiceUnavailableException } from '@nestjs/common';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { erstelleFixture, type Fixture } from '../../test/fixture';

import { PublicHealthController } from './health.controller';

/** Öffentlicher Prüfpunkt für externe Überwachung (Uptime Kuma): erreichbar über den Proxy unter /api/v1/public/health. */
describe('Öffentlicher Health-Endpunkt', () => {
  describe('Antwort', () => {
    it('antwortet ohne Anmeldung mit 200, wenn die Datenbank erreichbar ist, und nennt keine Details', async () => {
      const f: Fixture = await erstelleFixture('pulsedeck_public_health_test');
      try {
        const antwort = await f.api('get', '/api/v1/public/health', null);
        expect(antwort.status).toBe(200);
        expect(antwort.body).toEqual({ status: 'ok' });
      } finally {
        await f.schliessen();
      }
    });

    it('antwortet mit 503 und ohne Fehlerdetails, wenn die Datenbank nicht antwortet', async () => {
      const geheim = 'connect ECONNREFUSED 10.0.0.5:5432 user=pulsedeck_runtime';
      const kontroller = new PublicHealthController(async () => {
        throw new Error(geheim);
      });

      const fehler = await kontroller.pruefen().catch((e: unknown) => e);

      expect(fehler).toBeInstanceOf(ServiceUnavailableException);
      expect(JSON.stringify((fehler as ServiceUnavailableException).getResponse())).not.toContain('ECONNREFUSED');
      expect(JSON.stringify((fehler as ServiceUnavailableException).getResponse())).not.toContain('10.0.0.5');
    });
  });
});
