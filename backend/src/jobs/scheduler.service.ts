import { Inject, Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import type { Pool } from 'pg';

import { MAINTENANCE_PURGER } from '../auth/auth.tokens';
import { APP_CONFIG, type AppConfig } from '../config/configuration';
import { PG_POOL } from '../infrastructure/postgres/pg.pool';
import { NewsletterService } from '../newsletter/newsletter.service';
import { KnowledgeService } from '../knowledge/knowledge.service';
import { PushService } from '../push/push.service';

import { MailOutbox } from './mail-outbox';

interface JobAufgabe {
  name: string;
  /** Mindestabstand zwischen zwei Läufen, über alle Instanzen. */
  intervallSekunden: number;
  ausfuehren(): Promise<unknown>;
}

/**
 * Periodische Hintergrundarbeit im Backend-Prozess (Ersatz für pg_cron/pg_net und die Cron-Trigger der Edge Functions).
 * Jede Aufgabe wird über `scheduler_state` beansprucht: Läuft das Backend mehrfach, führt genau eine Instanz sie je
 * Intervall aus. Die Outbox ist davon unabhängig (SKIP LOCKED) und läuft in jedem Tick.
 */
@Injectable()
export class SchedulerService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger('Scheduler');
  private timer: NodeJS.Timeout | null = null;
  private laufend: Promise<void> | null = null;

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(PG_POOL) private readonly pool: Pool,
    @Inject(MAINTENANCE_PURGER) private readonly purger: { purgeExpiredTokens(): Promise<void> },
    private readonly outbox: MailOutbox,
    private readonly newsletter: NewsletterService,
    private readonly push: PushService,
    private readonly wissen: KnowledgeService
  ) {}

  onApplicationBootstrap(): void {
    if (!this.config.jobs.enabled) return;
    this.timer = setInterval(() => void this.tick(), this.config.jobs.tickMs);
    this.timer.unref();
  }

  async onModuleDestroy(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    await this.laufend;
  }

  /** Ein Durchlauf; nicht überlappend. Öffentlich, damit Tests ihn deterministisch auslösen können. */
  async tick(): Promise<void> {
    if (this.laufend) return this.laufend;
    this.laufend = this.durchlauf().finally(() => {
      this.laufend = null;
    });
    return this.laufend;
  }

  /** Beansprucht `name` für ein Intervall: Nur die erste Instanz, die es versucht, bekommt true. */
  async beanspruchen(name: string, intervallSekunden: number): Promise<boolean> {
    const { rowCount } = await this.pool.query(
      `INSERT INTO scheduler_state (name, last_run_at) VALUES ($1, now())
       ON CONFLICT (name) DO UPDATE SET last_run_at = now() WHERE scheduler_state.last_run_at <= now() - make_interval(secs => $2)`,
      [name, intervallSekunden]
    );
    return (rowCount ?? 0) > 0;
  }

  private async sicher(name: string, arbeit: () => Promise<unknown>): Promise<void> {
    try {
      await arbeit();
    } catch (fehler) {
      this.logger.error(`Aufgabe ${name} fehlgeschlagen: ${fehler instanceof Error ? fehler.message : 'unbekannter Fehler'}`);
    }
  }

  private async durchlauf(): Promise<void> {
    await this.sicher('outbox', () => this.outbox.leeren());
    await this.sicher('push', () => this.push.verarbeiten());
    await this.sicher('wissen-auftraege', () => this.wissen.auftraegeAbarbeiten());
    // Der Newsletter-Zeitplan wird etwa minütlich geprüft (knapp unter 60 s, damit ein Takt von 15 s nie einen Tick auslässt).
    const aufgaben: JobAufgabe[] = [
      { name: 'newsletter', intervallSekunden: 55, ausfuehren: () => this.newsletter.faelligeVersenden() },
      { name: 'wissen-stammdaten', intervallSekunden: 24 * 3600 - 300, ausfuehren: () => this.wissen.stammdatenAktualisieren() },
      {
        name: 'wartung',
        intervallSekunden: 3600,
        ausfuehren: async () => {
          await this.purger.purgeExpiredTokens();
          await this.outbox.bereinigen();
          await this.pool.query("DELETE FROM rate_limits WHERE window_start < now() - interval '2 days'");
          await this.pool.query("DELETE FROM push_notification_queue WHERE status <> 'pending' AND created_at < now() - interval '14 days'");
        },
      },
    ];
    for (const aufgabe of aufgaben) {
      await this.sicher(aufgabe.name, async () => {
        if (await this.beanspruchen(aufgabe.name, aufgabe.intervallSekunden)) await aufgabe.ausfuehren();
      });
    }
  }
}
