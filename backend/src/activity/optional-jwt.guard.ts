import { CanActivate, ExecutionContext, Inject, Injectable } from '@nestjs/common';

import { AUTH_USER_REPOSITORY } from '../auth/auth.tokens';
import type { AuthUserRepository } from '../auth/auth-user.repository';
import { TokenService } from '../auth/token.service';

/**
 * Für Endpunkte, die auch anonym nutzbar sind (Feedback, Analytics): Ein gültiges Bearer-Token setzt `userId`,
 * ein fehlendes oder ungültiges lässt den Aufruf anonym durch. Nie ein Fehler, nie eine Identität aus dem Body.
 */
@Injectable()
export class OptionalJwtGuard implements CanActivate {
  constructor(
    private readonly tokens: TokenService,
    @Inject(AUTH_USER_REPOSITORY) private readonly users: AuthUserRepository
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<{ headers: { authorization?: string }; userId?: string }>();
    const kopf = request.headers.authorization;
    if (!kopf?.startsWith('Bearer ')) return true;
    try {
      const sub = (await this.tokens.verifyAccessToken(kopf.slice(7))).sub;
      const nutzer = await this.users.findById(sub);
      if (nutzer && !nutzer.isBlocked) request.userId = sub;
    } catch {
      // anonym weiter
    }
    return true;
  }
}
