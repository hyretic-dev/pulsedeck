import { Body, Controller, Get, Inject, Param, Post, Res, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiParam, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';

import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import type { RateLimiter } from '../auth/rate-limiter';
import { apiFehler, ungueltig } from '../common/http-error';
import type { Membership } from '../tenancy/membership';
import { OrgGuard } from '../tenancy/org.guard';
import { PermissionGuard } from '../tenancy/require-permission';
import { CurrentMembership, CurrentUserId } from '../tenancy/request-context';

import { ChatService } from './chat.service';
import { CHAT_RATE_LIMITER } from './chat.tokens';
import { ChatRequestDto } from './dto/chat.dto';

@ApiTags('chat')
@ApiBearerAuth()
@ApiParam({ name: 'orgId', format: 'uuid' })
@Controller('orgs/:orgId/chat')
@UseGuards(JwtAuthGuard, OrgGuard, PermissionGuard)
export class ChatController {
  constructor(
    private readonly chat: ChatService,
    @Inject(CHAT_RATE_LIMITER) private readonly limiter: RateLimiter
  ) {}

  @Get('history')
  verlauf(@CurrentUserId() userId: string, @Param('orgId') orgId: string) {
    return this.chat.verlauf(userId, orgId);
  }

  /**
   * Antwort als Datenstrom im Vercel-AI-SDK-Format (Zeilen `0:"Text"`, Abschluss `d:{…}`), Sitzungs-ID im Header
   * `x-chat-session-id`. Prüfungen laufen vor dem ersten Byte, damit Fehler normale HTTP-Fehler bleiben.
   */
  @Post()
  async senden(@CurrentUserId() userId: string, @CurrentMembership() aufrufer: Membership, @Param('orgId') orgId: string, @Body() dto: ChatRequestDto, @Res() res: Response): Promise<void> {
    if (!this.chat.verfuegbar) throw apiFehler(503, 'ai_disabled', 'Der Chat ist nicht eingerichtet (MISTRAL_API_KEY)');
    if (!(await this.limiter.consume(`chat:${aufrufer.member.id}`)).allowed) throw apiFehler(429, 'rate_limited', 'Zu viele Chat-Anfragen; bitte später erneut versuchen');
    const verlauf = dto.messages.filter((m) => m.content.trim() !== '');
    if (verlauf.length === 0 || verlauf[verlauf.length - 1].role !== 'user') throw ungueltig('Die letzte Nachricht muss vom Nutzer stammen');
    const sessionId = await this.chat.sitzung(userId, orgId, dto.session_id);

    res.status(200);
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('X-Vercel-AI-Data-Stream', 'v1');
    res.setHeader('X-Chat-Session-Id', sessionId);
    res.setHeader('Access-Control-Expose-Headers', 'X-Chat-Session-Id');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Accel-Buffering', 'no'); // nginx soll nicht puffern
    res.flushHeaders();
    const abbruch = new AbortController();
    res.on('close', () => abbruch.abort());
    try {
      for await (const stueck of this.chat.antworten({ userId, orgId, aufrufer }, sessionId, verlauf, abbruch.signal)) res.write(`0:${JSON.stringify(stueck)}\n`);
      res.write(`d:${JSON.stringify({ finishReason: 'stop', usage: { promptTokens: 0, completionTokens: 0 } })}\n`);
    } catch {
      if (!res.writableEnded) res.write(`3:${JSON.stringify('Die Antwort konnte nicht erstellt werden.')}\n`);
    } finally {
      res.end();
    }
  }
}
