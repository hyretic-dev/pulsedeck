import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { vi } from 'vitest';

import { AppModule } from '../src/app.module';
import { configureApp, createHttpAdapter, setupOpenApi } from '../src/app.bootstrap';
import { MAIL_SENDER } from '../src/auth/auth.tokens';
import type { MailSender } from '../src/auth/mail.sender';
import { TokenService } from '../src/auth/token.service';
import { APP_CONFIG, type AppConfig } from '../src/config/configuration';
import { MAIL_DISPATCHER } from '../src/mail/mail-dispatcher';
import { MAIL_TRANSPORT } from '../src/mail/mail-transport';
import { PUSH_SENDER } from '../src/push/push-sender';
import { LLM_CLIENT } from '../src/ai/llm';

/** Nest-App mit ECHTEN PostgreSQL-Ports (Runtime-Rolle); nur der Mailversand ist ein Spion. */
export interface PgTestApp {
  app: INestApplication;
  mailer: { [K in keyof MailSender]: ReturnType<typeof vi.fn> };
  dispatcher: { dispatch: ReturnType<typeof vi.fn> };
  /** Plattform-Transport (Outbox, Dispatcher): Spion statt echtem Versand. */
  transport: { send: ReturnType<typeof vi.fn> };
  /** Push-Versand: Spion statt Push-Dienst. */
  pushSender: { send: ReturnType<typeof vi.fn> };
  /** Sprachmodell: skriptbarer Ersatz (Einbettungen und Chat). */
  llm: { einbetten: ReturnType<typeof vi.fn>; chat: ReturnType<typeof vi.fn> };
  tokens: TokenService;
  config: AppConfig;
}

export async function buildPgTestApp(runtimeUrl: string, konfiguration: Partial<AppConfig> = {}): Promise<PgTestApp> {
  const config: AppConfig = {
    port: 0,
    appBaseUrl: 'https://app.pulsedeck.example',
    jwt: {
      secret: new TextEncoder().encode('test-secret-test-secret-test-secret-1234'),
      issuer: 'pulsedeck-test',
      audience: 'pulsedeck-app',
      accessTtlSeconds: 900,
    },
    databaseUrl: runtimeUrl,
    mail: { transport: 'log' },
    maintenanceToken: null,
    poolMax: 4,
    minResponseMs: 0,
    rateLimits: {
      login: { max: 50, windowMs: 15 * 60 * 1000 },
      mail: { max: 50, windowMs: 60 * 60 * 1000 },
    },
    secretsKey: Buffer.alloc(32, 7),
    jobs: { enabled: false, tickMs: 15_000 },
    smtpAllowPrivateHosts: false,
    push: { publicKey: 'BEl62iUYgUivxIkv69yViEuiBIa-Ib9-SkvMeAtA3LFgDzkrxZJjSgSnfckjBJuBkr3qBUYIHBQFLXYp5Nksh8U', privateKey: 'UUxI4O8-FbRouAevSmBQ6o18hgE4nSG3qwvJTfKc-ls', subject: 'mailto:test@pulsedeck.example' },
    timeZone: 'Europe/Berlin',
    storage: { dir: mkdtempSync(join(tmpdir(), 'pulsedeck-files-')), maxUploadBytes: 1024 * 1024 },
    ai: { mistralApiKey: 'test-key', baseUrl: 'http://127.0.0.1:9' },
    docsFile: null,
    realtime: { enabled: true, heartbeatMs: 25_000, recheckMs: 60_000, maxPerUser: 5 },
    corsOrigins: [],
    ...konfiguration,
  };
  const mailer = {
    sendVerificationEmail: vi.fn().mockResolvedValue(undefined),
    sendMagicLinkEmail: vi.fn().mockResolvedValue(undefined),
    sendInvitationEmail: vi.fn().mockResolvedValue(undefined),
    sendPasswordResetEmail: vi.fn().mockResolvedValue(undefined),
  };

  const dispatcher = { dispatch: vi.fn().mockResolvedValue(undefined) };
  const transport = { send: vi.fn().mockResolvedValue(undefined) };
  const pushSender = { send: vi.fn().mockResolvedValue(undefined) };
  const llm = {
    einbetten: vi.fn(async (texte: string[]) => texte.map(() => Array.from({ length: 1024 }, () => 0))),
    chat: vi.fn(async function* () {
      yield { typ: 'text' as const, text: 'Antwort' };
    }),
  };

  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(APP_CONFIG)
    .useValue(config)
    .overrideProvider(MAIL_SENDER)
    .useValue(mailer)
    .overrideProvider(MAIL_DISPATCHER)
    .useValue(dispatcher)
    .overrideProvider(MAIL_TRANSPORT)
    .useValue(transport)
    .overrideProvider(PUSH_SENDER)
    .useValue(pushSender)
    .overrideProvider(LLM_CLIENT)
    .useValue(llm)
    .compile();
  const app = moduleRef.createNestApplication(createHttpAdapter());
  configureApp(app);
  setupOpenApi(app);
  await app.init();

  return { app, mailer, dispatcher, transport, pushSender, llm, tokens: new TokenService(config.jwt), config };
}
