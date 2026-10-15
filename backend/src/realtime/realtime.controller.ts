import { Controller, Get, Param, Query, Req, Res, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiParam, ApiTags } from '@nestjs/swagger';
import { IsOptional, Matches } from 'class-validator';
import type { Request, Response } from 'express';

import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { apiFehler, ungueltig } from '../common/http-error';
import { OrgGuard } from '../tenancy/org.guard';
import { PermissionGuard } from '../tenancy/require-permission';
import { CurrentUserId } from '../tenancy/request-context';

import { REALTIME_TABELLEN, RealtimeService } from './realtime.service';

export class RealtimeQuery {
  /** Kommagetrennte Tabellenliste; leer = alle freigegebenen Tabellen. */
  @IsOptional() @Matches(/^[a-z_,]{1,500}$/) tables?: string;
}

@ApiTags('realtime')
@ApiBearerAuth()
@ApiParam({ name: 'orgId', format: 'uuid' })
@Controller('orgs/:orgId/realtime')
@UseGuards(JwtAuthGuard, OrgGuard, PermissionGuard)
export class RealtimeController {
  constructor(private readonly realtime: RealtimeService) {}

  /**
   * Server-Sent Events: `event: change` mit `{table, operation, id}` je Änderung der Organisation, `event: resync` nach einer
   * Unterbrechung (alles neu laden), Kommentarzeilen als Herzschlag. Der Client sendet das Bearer-Token per fetch.
   */
  @Get()
  strom(@CurrentUserId() userId: string, @Param('orgId') orgId: string, @Query() query: RealtimeQuery, @Req() req: Request, @Res() res: Response): void {
    if (!this.realtime.aktiv) throw apiFehler(503, 'realtime_disabled', 'Echtzeit ist deaktiviert');
    let tabellen: Set<string> | null = null;
    if (query.tables) {
      tabellen = new Set(query.tables.split(',').filter(Boolean));
      const unbekannt = [...tabellen].filter((t) => !(REALTIME_TABELLEN as readonly string[]).includes(t));
      if (unbekannt.length > 0) throw ungueltig(`Unbekannte Tabellen: ${unbekannt.join(', ')}`);
    }
    const abmelden = this.realtime.anmelden({ userId, orgId, tabellen, res });
    res.status(200);
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();
    res.write('retry: 5000\n\nevent: ready\ndata: {}\n\n');
    req.on('close', abmelden);
  }
}
