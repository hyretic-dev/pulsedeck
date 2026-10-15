import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { vi } from 'vitest';

import { AppModule } from '../src/app.module';
import { configureApp, createHttpAdapter, setupOpenApi } from '../src/app.bootstrap';
import {
  AUTH_USER_REPOSITORY,
  LOGIN_RATE_LIMITER,
  MAIL_RATE_LIMITER,
  MAIL_SENDER,
  MAINTENANCE_PURGER,
  READINESS_CHECK,
  REFRESH_TOKEN_STORE,
  VERIFICATION_TOKEN_STORE,
} from '../src/auth/auth.tokens';
import type { MailSender } from '../src/auth/mail.sender';
import { BcryptPasswordHasher } from '../src/auth/password-hasher';
import { InMemoryRateLimiter } from './in-memory.rate-limiter';
import { APP_CONFIG } from '../src/config/configuration';
import { PG_POOL } from '../src/infrastructure/postgres/pg.pool';
import { MEMBER_LINKER, MEMBERSHIP_REPOSITORY } from '../src/tenancy/tenancy.tokens';
import {
  InMemoryAuthUserRepository,
  InMemoryRefreshTokenStore,
  InMemoryVerificationTokenStore,
} from './auth-memory-stores';

export interface TestPorts {
  users: InMemoryAuthUserRepository;
  refreshTokens: InMemoryRefreshTokenStore;
  verificationTokens: InMemoryVerificationTokenStore;
  mailer: MailSender;
  loginLimiter: InMemoryRateLimiter;
  mailLimiter: InMemoryRateLimiter;
}

export interface TestApp {
  app: INestApplication;
  ports: TestPorts;
  /** JSON-Zeilen des Zugriffslogs. */
  accessLog: string[];
}

const TEST_CONFIG = {
  port: 0,
  appBaseUrl: 'https://app.pulsedeck.example',
  jwt: {
    secret: new TextEncoder().encode('test-secret-test-secret-test-secret-1234'),
    issuer: 'pulsedeck-test',
    audience: 'pulsedeck-app',
    accessTtlSeconds: 900,
  },
  databaseUrl: 'postgres://test:test@localhost:5432/test',
  mail: { transport: 'log' },
  maintenanceToken: 'wartungstoken',
  minResponseMs: 0,
  poolMax: 2,
  rateLimits: {
    login: { max: 5, windowMs: 15 * 60 * 1000 },
    mail: { max: 3, windowMs: 60 * 60 * 1000 },
  },
  secretsKey: null,
  jobs: { enabled: false, tickMs: 15_000 },
  smtpAllowPrivateHosts: false,
  push: null,
  timeZone: 'Europe/Berlin',
  storage: { dir: '/tmp/pulsedeck-test-files', maxUploadBytes: 1024 * 1024 },
  ai: null,
  docsFile: null,
  realtime: { enabled: false, heartbeatMs: 25_000, recheckMs: 60_000, maxPerUser: 5 },
  corsOrigins: [] as string[],
};

/** Nest-App mit In-Memory-Ports; identische Konfiguration wie main (Präfix, Pipes, Filter). */
export async function buildTestApp(
  overrides: Partial<typeof TEST_CONFIG> = {}
): Promise<TestApp> {
  const config = { ...TEST_CONFIG, ...overrides };
  const users = new InMemoryAuthUserRepository();
  const refreshTokens = new InMemoryRefreshTokenStore();
  const verificationTokens = new InMemoryVerificationTokenStore();
  const mailer: MailSender = {
    sendVerificationEmail: vi.fn(),
    sendMagicLinkEmail: vi.fn(),
    sendInvitationEmail: vi.fn().mockResolvedValue(undefined),
    sendPasswordResetEmail: vi.fn(),
  };
  const loginLimiter = new InMemoryRateLimiter(TEST_CONFIG.rateLimits.login);
  const mailLimiter = new InMemoryRateLimiter(TEST_CONFIG.rateLimits.mail);

  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(APP_CONFIG)
    .useValue(config)
    .overrideProvider(PG_POOL)
    .useValue({ end: () => Promise.resolve() })
    .overrideProvider(AUTH_USER_REPOSITORY)
    .useValue(users)
    .overrideProvider(REFRESH_TOKEN_STORE)
    .useValue(refreshTokens)
    .overrideProvider(VERIFICATION_TOKEN_STORE)
    .useValue(verificationTokens)
    .overrideProvider(MAIL_SENDER)
    .useValue(mailer)
    .overrideProvider(LOGIN_RATE_LIMITER)
    .useValue(loginLimiter)
    .overrideProvider(MAIL_RATE_LIMITER)
    .useValue(mailLimiter)
    .overrideProvider(READINESS_CHECK)
    .useValue(() => Promise.resolve())
    .overrideProvider(MEMBER_LINKER)
    .useValue({ linkByVerifiedEmail: async () => 0, findInvitationTargets: async () => [] })
    .overrideProvider(MEMBERSHIP_REPOSITORY)
    .useValue({ listForUser: async () => [], find: async () => null, listRoles: async () => [] })
    .overrideProvider(MAINTENANCE_PURGER)
    .useValue({ purgeExpiredTokens: vi.fn() })
    .overrideProvider(BcryptPasswordHasher)
    .useValue({
      verify: (password: string, hash: string) => hash === `hash(${password})`,
      hash: (password: string) => `hash(${password})`,
    })
    .compile();

  const app = moduleRef.createNestApplication(createHttpAdapter());
  const accessLog: string[] = [];
  configureApp(app, { writeAccessLog: (zeile) => accessLog.push(zeile), corsOrigins: config.corsOrigins });
  setupOpenApi(app);

  return { app, accessLog, ports: { users, refreshTokens, verificationTokens, mailer, loginLimiter, mailLimiter } };
}
