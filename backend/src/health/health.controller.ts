import { Controller, Get, Inject, ServiceUnavailableException } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';

import { READINESS_CHECK } from '../auth/auth.tokens';

/** Health-Endpunkte ohne /api/v1-Präfix: nur intern (Container-Healthcheck, Reverse Proxy). */
@Controller('health')
export class HealthController {
  constructor(
    @Inject(READINESS_CHECK) private readonly readiness: () => Promise<void>
  ) {}

  @Get('liveness')
  liveness(): { status: 'ok' } {
    return { status: 'ok' };
  }

  @Get('readiness')
  async readinessCheck(): Promise<{ status: 'ok' }> {
    try {
      await this.readiness();
      return { status: 'ok' };
    } catch (fehler) {
      throw new ServiceUnavailableException(
        fehler instanceof Error ? `Readiness fehlgeschlagen: ${fehler.message}` : 'Readiness fehlgeschlagen'
      );
    }
  }
}

/**
 * Öffentlicher Prüfpunkt für externe Überwachung (z. B. Uptime Kuma): `GET /api/v1/public/health` kommt über den nginx-Proxy
 * der App bis hierher und prüft damit die ganze Kette (Proxy, Backend, Datenbank). Antwort ohne Fehlerdetails, damit nichts
 * über die Infrastruktur nach außen dringt; Einzelheiten stehen im Log.
 */
@ApiTags('public')
@Controller('public/health')
export class PublicHealthController {
  constructor(
    @Inject(READINESS_CHECK) private readonly readiness: () => Promise<void>
  ) {}

  @Get()
  async pruefen(): Promise<{ status: 'ok' }> {
    try {
      await this.readiness();
      return { status: 'ok' };
    } catch {
      throw new ServiceUnavailableException({ code: 'unavailable', message: 'Dienst nicht bereit' });
    }
  }
}
