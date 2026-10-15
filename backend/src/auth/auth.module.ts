import { Module } from '@nestjs/common';
import type { Pool } from 'pg';

import { APP_CONFIG } from '../config/configuration';
import type { AppConfig } from '../config/configuration';
import { PG_POOL } from '../infrastructure/postgres/pg.pool';
import { PgRateLimiter } from '../infrastructure/postgres/pg.rate-limiter';
import { PgRefreshTokenStore } from '../infrastructure/postgres/pg.refresh-token-store';
import { PgVerificationTokenStore } from '../infrastructure/postgres/pg.verification-token-store';
import { MEMBER_LINKER } from '../tenancy/tenancy.tokens';
import { TenancyModule } from '../tenancy/tenancy.module';
import type { MemberLinker } from '../tenancy/membership';

import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import type { PasswordHasher } from './auth.service';
import { AuthCoreModule } from './auth-core.module';
import type { AuthUserRepository } from './auth-user.repository';
import {
  AUTH_USER_REPOSITORY,
  LOGIN_RATE_LIMITER,
  MAIL_RATE_LIMITER,
  MAIL_SENDER,
  MIN_RESPONSE_MS,
  REFRESH_TOKEN_STORE,
  VERIFICATION_TOKEN_STORE,
} from './auth.tokens';
import type { MailSender } from './mail.sender';
import { BcryptPasswordHasher } from './password-hasher';
import type { RefreshTokenStore } from './refresh-token.store';
import { TokenService } from './token.service';
import type { VerificationTokenStore } from './verification-token.store';

/** Authentifizierung: Endpunkte, Sessions, Tokens, Rate-Limits. */
@Module({
  imports: [AuthCoreModule, TenancyModule],
  controllers: [AuthController],
  providers: [
    BcryptPasswordHasher,
    {
      provide: REFRESH_TOKEN_STORE,
      useFactory: (pool: Pool) => new PgRefreshTokenStore(pool),
      inject: [PG_POOL],
    },
    {
      provide: VERIFICATION_TOKEN_STORE,
      useFactory: (pool: Pool) => new PgVerificationTokenStore(pool),
      inject: [PG_POOL],
    },
    {
      provide: MIN_RESPONSE_MS,
      useFactory: (config: AppConfig) => config.minResponseMs,
      inject: [APP_CONFIG],
    },
    {
      provide: LOGIN_RATE_LIMITER,
      useFactory: (pool: Pool, config: AppConfig) => new PgRateLimiter(pool, config.rateLimits.login),
      inject: [PG_POOL, APP_CONFIG],
    },
    {
      provide: MAIL_RATE_LIMITER,
      useFactory: (pool: Pool, config: AppConfig) => new PgRateLimiter(pool, config.rateLimits.mail),
      inject: [PG_POOL, APP_CONFIG],
    },
    {
      provide: AuthService,
      useFactory: (
        users: AuthUserRepository,
        hasher: PasswordHasher,
        tokens: TokenService,
        refreshTokens: RefreshTokenStore,
        verificationTokens: VerificationTokenStore,
        mailer: MailSender,
        config: AppConfig,
        memberLinker: MemberLinker
      ) =>
        new AuthService(
          users,
          hasher,
          tokens,
          refreshTokens,
          verificationTokens,
          mailer,
          config.appBaseUrl,
          memberLinker
        ),
      inject: [
        AUTH_USER_REPOSITORY,
        BcryptPasswordHasher,
        TokenService,
        REFRESH_TOKEN_STORE,
        VERIFICATION_TOKEN_STORE,
        MAIL_SENDER,
        APP_CONFIG,
        MEMBER_LINKER,
      ],
    },
  ],
  exports: [AuthService],
})
export class AuthModule {}
