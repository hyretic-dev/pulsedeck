import { Controller, Get, Header, Res, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';

import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUserId } from '../tenancy/request-context';

import { AccountService } from './account.service';

/**
 * Eigenes Konto. Löschen gibt es hier bewusst nicht: Mitglieder entfernt der Vorstand der Organisation,
 * Konten werden auf Anfrage gelöscht (E40).
 */
@ApiTags('me')
@ApiBearerAuth()
@Controller('me')
@UseGuards(JwtAuthGuard)
export class AccountController {
  constructor(private readonly account: AccountService) {}

  /** Alle Daten zur eigenen Person als JSON-Download (Art. 15/20 DSGVO). */
  @Get('export')
  @Header('Cache-Control', 'no-store')
  async export(@CurrentUserId() userId: string, @Res({ passthrough: true }) res: Response): Promise<Record<string, unknown>> {
    res.setHeader('Content-Disposition', `attachment; filename="pulsedeck-export-${new Date().toISOString().slice(0, 10)}.json"`);
    return this.account.export(userId);
  }
}
