import {
  CanActivate,
  ExecutionContext,
  HttpException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Inject } from '@nestjs/common';

import { AUTH_USER_REPOSITORY } from './auth.tokens';
import { TokenService } from './token.service';
import type { AuthUserRepository } from './auth-user.repository';

/** Nutzer am Request; Identität kommt ausschließlich aus dem verifizierten Bearer-JWT. */
export interface AuthentifizierterRequest {
  userId: string;
}

/**
 * Prüft Bearer-JWT (HS256, iss, aud, exp), lädt den Nutzer und lehnt
 * gesperrte Konten ab. Nutzer-ID wird serverseitig gesetzt.
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly tokens: TokenService,
    @Inject(AUTH_USER_REPOSITORY)
    private readonly users: AuthUserRepository
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context
      .switchToHttp()
      .getRequest<{ headers: { authorization?: string }; userId?: string }>();

    const authorization = request.headers.authorization;
    if (!authorization?.startsWith('Bearer ')) {
      throw new HttpException(
        { code: 'unauthorized', message: 'Nicht authentifiziert' },
        401
      );
    }

    let userId: string;
    try {
      userId = (await this.tokens.verifyAccessToken(authorization.slice(7))).sub;
    } catch {
      throw new UnauthorizedException('Sitzung ungültig oder abgelaufen');
    }

    const user = await this.users.findById(userId);
    if (!user || user.isBlocked) {
      throw new UnauthorizedException('Sitzung ungültig oder abgelaufen');
    }

    request.userId = userId;
    return true;
  }
}
