import { Global, Inject, Injectable, Module, OnModuleDestroy } from '@nestjs/common';
import type { Pool } from 'pg';

import { MAIL_SENDER, MAINTENANCE_PURGER, READINESS_CHECK } from '../auth/auth.tokens';
import type { MailSender } from '../auth/mail.sender';
import { APP_CONFIG, loadAppConfig } from '../config/configuration';
import type { AppConfig } from '../config/configuration';
import { HealthController, PublicHealthController } from '../health/health.controller';
import { PgMaintenance } from '../infrastructure/postgres/pg.maintenance';
import { PG_POOL, createPgPool } from '../infrastructure/postgres/pg.pool';
import { MAIL_DISPATCHER, TransportMailDispatcher, createMailTransport } from '../mail/mail-dispatcher';
import { MAIL_TRANSPORT, type MailTransport } from '../mail/mail-transport';
import { SECRET_BOX, SecretBox } from '../common/secret-box';
import { createMailSender } from '../mail/mail-sender.factory';
import { MaintenanceController } from '../maintenance/maintenance.controller';

/** Schließt den Pool beim Shutdown: keine offenen Handles nach Test-/Serverende. */
@Injectable()
export class PgPoolCloser implements OnModuleDestroy {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  onModuleDestroy(): Promise<void> {
    return this.pool.end();
  }
}

/**
 * Querschnitt für alle Module: validierte Konfiguration, Datenbankpool, Mailversand,
 * Health und Wartung. Global, damit Fachmodule nur ihre eigenen Abhängigkeiten deklarieren.
 */
@Global()
@Module({
  controllers: [HealthController, PublicHealthController, MaintenanceController],
  providers: [
    { provide: APP_CONFIG, useFactory: () => loadAppConfig(process.env) },
    {
      provide: PG_POOL,
      useFactory: (config: AppConfig) => createPgPool(config.databaseUrl, config.poolMax),
      inject: [APP_CONFIG],
    },
    {
      provide: MAIL_SENDER,
      useFactory: (config: AppConfig): MailSender => createMailSender(config.mail),
      inject: [APP_CONFIG],
    },
    {
      provide: MAIL_TRANSPORT,
      useFactory: (config: AppConfig) => createMailTransport(config.mail),
      inject: [APP_CONFIG],
    },
    {
      provide: MAIL_DISPATCHER,
      useFactory: (transport: MailTransport) => new TransportMailDispatcher(transport),
      inject: [MAIL_TRANSPORT],
    },
    {
      provide: SECRET_BOX,
      useFactory: (config: AppConfig) => new SecretBox(config.secretsKey),
      inject: [APP_CONFIG],
    },
    {
      provide: READINESS_CHECK,
      useFactory: (pool: Pool) => async (): Promise<void> => {
        await pool.query('SELECT 1');
      },
      inject: [PG_POOL],
    },
    {
      provide: MAINTENANCE_PURGER,
      useFactory: (pool: Pool) => new PgMaintenance(pool),
      inject: [PG_POOL],
    },
    PgPoolCloser,
  ],
  exports: [APP_CONFIG, PG_POOL, MAIL_SENDER, MAIL_TRANSPORT, MAIL_DISPATCHER, SECRET_BOX, READINESS_CHECK, MAINTENANCE_PURGER],
})
export class PlatformModule {}
