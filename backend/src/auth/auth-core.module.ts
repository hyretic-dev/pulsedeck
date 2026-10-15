import { Module } from '@nestjs/common';
import type { Pool } from 'pg';

import { APP_CONFIG } from '../config/configuration';
import type { AppConfig } from '../config/configuration';
import { PgAuthUserRepository } from '../infrastructure/postgres/pg.auth-user-repository';
import { PG_POOL } from '../infrastructure/postgres/pg.pool';

import { AUTH_USER_REPOSITORY } from './auth.tokens';
import { JwtAuthGuard } from './jwt-auth.guard';
import { TokenService } from './token.service';

/**
 * Kern der Authentifizierung, den jedes geschützte Modul braucht: Token-Prüfung, Benutzerzugriff
 * und der JwtAuthGuard. Bewusst getrennt vom AuthModule (Endpunkte, Sessions), damit Tenancy und
 * Fachmodule den Guard nutzen können, ohne einen Modulzyklus zu bilden.
 */
@Module({
  providers: [
    {
      provide: TokenService,
      useFactory: (config: AppConfig) => new TokenService(config.jwt),
      inject: [APP_CONFIG],
    },
    {
      provide: AUTH_USER_REPOSITORY,
      useFactory: (pool: Pool) => new PgAuthUserRepository(pool),
      inject: [PG_POOL],
    },
    JwtAuthGuard,
  ],
  exports: [TokenService, AUTH_USER_REPOSITORY, JwtAuthGuard],
})
export class AuthCoreModule {}
