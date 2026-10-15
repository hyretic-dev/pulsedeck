import {
  Body,
  Controller,
  HttpCode,
  Inject,
  NotFoundException,
  Post,
  Req,
} from '@nestjs/common';
import { timingSafeEqual } from 'node:crypto';
import type { Request } from 'express';

import { APP_CONFIG } from '../config/configuration';
import { MAINTENANCE_PURGER } from '../auth/auth.tokens';

/**
 * Interner Wartungsendpunkt: bereinigt abgelaufene Tokens.
 * Geschützt durch MAINTENANCE_TOKEN; ohne Token-Konfiguration deaktiviert (404).
 */
@Controller('maintenance')
export class MaintenanceController {
  constructor(
    @Inject(APP_CONFIG)
    private readonly config: { maintenanceToken: string | null },
    @Inject(MAINTENANCE_PURGER)
    private readonly purger: { purgeExpiredTokens(): Promise<void> }
  ) {}

  @Post('purge-expired-tokens')
  @HttpCode(204)
  async purgeExpiredTokens(
    @Req() request: Request,
    @Body() _body: unknown
  ): Promise<void> {
    const erwartet = this.config.maintenanceToken;
    const erhalten = request.headers['x-maintenance-token'];
    if (!erwartet || typeof erhalten !== 'string' || !this.tokenGleich(erwartet, erhalten)) {
      // Ohne gültigen Token nicht als Endpunkt erkennbar (keine Enumeration).
      throw new NotFoundException();
    }
    await this.purger.purgeExpiredTokens();
  }

  private tokenGleich(erwartet: string, erhalten: string): boolean {
    const a = Buffer.from(erwartet);
    const b = Buffer.from(erhalten);
    if (a.length !== b.length) return false;
    return timingSafeEqual(a, b);
  }
}
