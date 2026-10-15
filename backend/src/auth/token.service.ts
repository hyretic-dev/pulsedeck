import { SignJWT, jwtVerify } from 'jose';

import type { AccessTokenIssuer } from './access-token.issuer';

export interface JwtPayload {
  sub: string;
}

export interface JwtConfig {
  secret: Uint8Array;
  issuer: string;
  audience: string;
  accessTtlSeconds: number;
}

/** Signiert Access-Token als HS256-JWT mit Issuer, Audience und fester Laufzeit; verifiziert sie signatur- und anspruchsbezogen. */
export class TokenService implements AccessTokenIssuer {
  constructor(private readonly config: JwtConfig) {}

  async signAccessToken(userId: string): Promise<string> {
    const now = Math.floor(Date.now() / 1000);
    return new SignJWT({})
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(userId)
      .setIssuer(this.config.issuer)
      .setAudience(this.config.audience)
      .setIssuedAt(now)
      .setExpirationTime(now + this.config.accessTtlSeconds)
      .sign(this.config.secret);
  }

  /** Wirft bei ungültiger Signatur, falschem iss/aud oder abgelaufenem exp. */
  async verifyAccessToken(token: string): Promise<JwtPayload> {
    const { payload } = await jwtVerify(token, this.config.secret, {
      algorithms: ['HS256'],
      issuer: this.config.issuer,
      audience: this.config.audience,
    });
    if (typeof payload.sub !== 'string') {
      throw new Error('Token ohne Subject');
    }
    return { sub: payload.sub };
  }
}
