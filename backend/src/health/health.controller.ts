import { Controller, Get, Inject, ServiceUnavailableException } from '@nestjs/common';

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
