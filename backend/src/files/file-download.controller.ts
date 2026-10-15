import { Controller, Get, HttpException, Inject, Param, ParseUUIDPipe, Query, Res } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';

import type { MembershipRepository } from '../tenancy/membership';
import { MEMBERSHIP_REPOSITORY } from '../tenancy/tenancy.tokens';

import { FileLinks } from './file-links';
import { sendeDatei } from './files.controller';
import { FilesService } from './files.service';

/** Einlösen kurzlebiger Download-Links sowie öffentlich freigegebene Dateien (anonym). */
@ApiTags('files')
@Controller()
export class FileDownloadController {
  constructor(
    private readonly dateien: FilesService,
    private readonly links: FileLinks,
    @Inject(MEMBERSHIP_REPOSITORY) private readonly mitgliedschaften: MembershipRepository
  ) {}

  @Get('files/download/:token')
  async einloesen(@Param('token') token: string, @Query('inline') inline: string | undefined, @Res() res: Response): Promise<void> {
    const { userId, orgId, fileId } = await this.links.pruefe(token);
    // Berechtigung gilt zum Zeitpunkt des Abrufs, nicht der Link-Erstellung: Wer inzwischen entfernt wurde, bekommt nichts.
    const aufrufer = await this.mitgliedschaften.find(userId, orgId);
    if (!aufrufer) throw new HttpException({ code: 'not_a_member', message: 'Kein Zugriff auf diese Organisation' }, 403);
    const { datei, ...quelle } = await this.dateien.oeffnen(orgId, aufrufer, fileId);
    sendeDatei(res, datei, quelle, inline === '1');
  }

  @Get('public/files/:fileId')
  async oeffentlich(@Param('fileId', ParseUUIDPipe) fileId: string, @Query('inline') inline: string | undefined, @Res() res: Response): Promise<void> {
    const { datei, ...quelle } = await this.dateien.oeffentlichOeffnen(fileId);
    sendeDatei(res, datei, quelle, inline === '1');
  }
}
