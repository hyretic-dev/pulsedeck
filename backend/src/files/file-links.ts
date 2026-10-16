import { Inject, Injectable } from '@nestjs/common';
import { SignJWT, jwtVerify } from 'jose';

import { apiFehler } from '../common/http-error';
import { APP_CONFIG, type AppConfig } from '../config/configuration';

const AUDIENCE = 'pulsedeck-file-download';
export const LINK_GUELTIGKEIT_SEKUNDEN = 300;

/**
 * Kurzlebige Download-Links: Der Link trägt nur Konto, Organisation und Datei und gilt
 * fünf Minuten. Beim Einlösen werden Mitgliedschaft und Sichtbarkeit erneut geprüft; der Token ist als Zugriffstoken unbrauchbar
 * (andere Zielgruppe).
 */
@Injectable()
export class FileLinks {
  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {}

  async erzeuge(userId: string, orgId: string, fileId: string): Promise<string> {
    return new SignJWT({ org: orgId, fid: fileId })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(userId)
      .setIssuer(this.config.jwt.issuer)
      .setAudience(AUDIENCE)
      .setIssuedAt()
      .setExpirationTime(`${LINK_GUELTIGKEIT_SEKUNDEN}s`)
      .sign(this.config.jwt.secret);
  }

  async pruefe(token: string): Promise<{ userId: string; orgId: string; fileId: string }> {
    try {
      const { payload } = await jwtVerify(token, this.config.jwt.secret, { issuer: this.config.jwt.issuer, audience: AUDIENCE, algorithms: ['HS256'] });
      if (typeof payload.sub !== 'string' || typeof payload.org !== 'string' || typeof payload.fid !== 'string') throw new Error('Claims');
      return { userId: payload.sub, orgId: payload.org, fileId: payload.fid };
    } catch {
      throw apiFehler(401, 'invalid_link', 'Der Download-Link ist ungültig oder abgelaufen');
    }
  }
}
