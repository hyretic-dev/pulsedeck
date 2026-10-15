import type { ReadStream } from 'node:fs';

import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query, Res, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiConsumes, ApiParam, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';

import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { ungueltig } from '../common/http-error';
import type { Membership } from '../tenancy/membership';
import { OrgGuard } from '../tenancy/org.guard';
import { PermissionGuard } from '../tenancy/require-permission';
import { CurrentMembership, CurrentUserId } from '../tenancy/request-context';

import { CreateFolderDto, FileListQuery, FolderListQuery, RenameFolderDto, UpdateFileDto, UploadFileDto } from './dto/file.dto';
import { FileLinks, LINK_GUELTIGKEIT_SEKUNDEN } from './file-links';
import { FilesService, INLINE_TYPEN, type HochgeladeneDatei } from './files.service';

const SICHERER_TYP = /^[a-z0-9][a-z0-9!#$&^_.+-]*\/[a-z0-9][a-z0-9!#$&^_.+-]*$/i;

/** Sendet eine Datei: immer mit nosniff und Sandbox-CSP; nur ungefährliche Typen dürfen inline angezeigt werden. */
export function sendeDatei(res: Response, datei: { name: string; mime_type: string | null }, quelle: { stream: ReadStream; size: number }, inline: boolean): void {
  const typ = datei.mime_type && SICHERER_TYP.test(datei.mime_type) ? datei.mime_type.toLowerCase() : 'application/octet-stream';
  const darfInline = inline && INLINE_TYPEN.includes(typ);
  res.setHeader('Content-Type', typ);
  res.setHeader('Content-Length', String(quelle.size));
  res.setHeader('Content-Disposition', `${darfInline ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(datei.name).replace(/['()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)}`);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Content-Security-Policy', "sandbox; default-src 'none'");
  res.setHeader('Cache-Control', 'private, no-store');
  quelle.stream.on('error', () => res.destroy());
  quelle.stream.pipe(res);
}

@ApiTags('files')
@ApiBearerAuth()
@ApiParam({ name: 'orgId', format: 'uuid' })
@Controller('orgs/:orgId')
@UseGuards(JwtAuthGuard, OrgGuard, PermissionGuard)
export class FilesController {
  constructor(
    private readonly dateien: FilesService,
    private readonly links: FileLinks
  ) {}

  @Get('files')
  liste(@Param('orgId') orgId: string, @CurrentMembership() aufrufer: Membership, @Query() query: FileListQuery) {
    return this.dateien.liste(orgId, aufrufer, { ...query });
  }

  @Post('files')
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(FileInterceptor('file'))
  hochladen(
    @CurrentUserId() userId: string,
    @CurrentMembership() aufrufer: Membership,
    @Param('orgId') orgId: string,
    @UploadedFile() datei: HochgeladeneDatei | undefined,
    @Body() meta: UploadFileDto
  ) {
    if (!datei || datei.size === 0) throw ungueltig('Es wurde keine Datei übermittelt');
    return this.dateien.hochladen(userId, orgId, aufrufer, datei, { ...meta });
  }

  @Get('files/:fileId')
  einzeln(@Param('orgId') orgId: string, @CurrentMembership() aufrufer: Membership, @Param('fileId', ParseUUIDPipe) fileId: string) {
    return this.dateien.einzeln(orgId, aufrufer, fileId);
  }

  @Patch('files/:fileId')
  aendern(
    @CurrentUserId() userId: string,
    @CurrentMembership() aufrufer: Membership,
    @Param('orgId') orgId: string,
    @Param('fileId', ParseUUIDPipe) fileId: string,
    @Body() dto: UpdateFileDto
  ) {
    return this.dateien.aendern(userId, orgId, aufrufer, fileId, { ...dto });
  }

  @Delete('files/:fileId')
  @HttpCode(204)
  async loeschen(@CurrentUserId() userId: string, @CurrentMembership() aufrufer: Membership, @Param('orgId') orgId: string, @Param('fileId', ParseUUIDPipe) fileId: string): Promise<void> {
    await this.dateien.loeschen(userId, orgId, aufrufer, fileId);
  }

  /** Inhalt mit Bearer-Token (für fetch/Blob). `?inline=1` nur für ungefährliche Typen. */
  @Get('files/:fileId/content')
  async inhalt(
    @Param('orgId') orgId: string,
    @CurrentMembership() aufrufer: Membership,
    @Param('fileId', ParseUUIDPipe) fileId: string,
    @Query('inline') inline: string | undefined,
    @Res() res: Response
  ): Promise<void> {
    const { datei, ...quelle } = await this.dateien.oeffnen(orgId, aufrufer, fileId);
    sendeDatei(res, datei, quelle, inline === '1');
  }

  /** Kurzlebiger Link für Links/Vorschau ohne Authorization-Header. */
  @Post('files/:fileId/download-link')
  @HttpCode(200)
  async link(@CurrentUserId() userId: string, @CurrentMembership() aufrufer: Membership, @Param('orgId') orgId: string, @Param('fileId', ParseUUIDPipe) fileId: string) {
    await this.dateien.einzeln(orgId, aufrufer, fileId);
    return { url: `/api/v1/files/download/${await this.links.erzeuge(userId, orgId, fileId)}`, expires_in: LINK_GUELTIGKEIT_SEKUNDEN };
  }

  @Get('folders')
  ordner(@Param('orgId') orgId: string, @CurrentMembership() aufrufer: Membership, @Query() query: FolderListQuery) {
    return this.dateien.ordner(orgId, aufrufer, query.parent_id);
  }

  @Post('folders')
  ordnerAnlegen(@CurrentUserId() userId: string, @CurrentMembership() aufrufer: Membership, @Param('orgId') orgId: string, @Body() dto: CreateFolderDto) {
    return this.dateien.ordnerAnlegen(userId, orgId, aufrufer, dto.name, dto.parent_id ?? null);
  }

  @Patch('folders/:folderId')
  ordnerUmbenennen(
    @CurrentUserId() userId: string,
    @CurrentMembership() aufrufer: Membership,
    @Param('orgId') orgId: string,
    @Param('folderId', ParseUUIDPipe) folderId: string,
    @Body() dto: RenameFolderDto
  ) {
    return this.dateien.ordnerUmbenennen(userId, orgId, aufrufer, folderId, dto.name);
  }

  @Delete('folders/:folderId')
  @HttpCode(204)
  async ordnerLoeschen(@CurrentUserId() userId: string, @CurrentMembership() aufrufer: Membership, @Param('orgId') orgId: string, @Param('folderId', ParseUUIDPipe) folderId: string): Promise<void> {
    await this.dateien.ordnerLoeschen(userId, orgId, aufrufer, folderId);
  }
}
