import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import type { Response } from 'express';
import { Client, type Notification } from 'pg';

import { apiFehler } from '../common/http-error';
import { CHANGES_CHANNEL, type ChangeEvent } from '../common/changes';
import { APP_CONFIG, type AppConfig } from '../config/configuration';
import type { MembershipRepository } from '../tenancy/membership';
import { MEMBERSHIP_REPOSITORY } from '../tenancy/tenancy.tokens';

/** Tabellen, deren Änderungen Clients abonnieren dürfen (alles, was die Module per `meldeAenderung` melden). */
export const REALTIME_TABELLEN = [
  'events', 'event_registrations', 'event_slots', 'event_slot_signups', 'event_guest_organizations',
  'feedback_submissions', 'feed_items', 'poll_votes', 'feed_item_reads', 'newsletter_config', 'wiki_docs', 'wiki_categories', 'contacts',
  'booking_calendars', 'booking_calendar_members', 'booking_series', 'bookings',
  'files', 'folders', 'members', 'organization_roles', 'working_groups', 'ag_memberships', 'working_group_members', 'skills', 'member_skills',
] as const;

export interface Abonnement {
  userId: string;
  orgId: string;
  tabellen: Set<string> | null;
  res: Response;
}

const MAX_GESAMT = 2000;
const MAX_PUFFER = 1024 * 1024;

/**
 * Echtzeit-Änderungen: Eine dedizierte PostgreSQL-Verbindung hört auf `table_changes` (NOTIFY kommt erst nach dem Commit der
 * Änderung, siehe `meldeAenderung`) und verteilt je Organisation an die offenen SSE-Verbindungen. Die Nachricht enthält nur
 * Tabelle, Operation und ID, nie Daten; Clients laden über die geschützten REST-Endpunkte nach. Das Abo gilt nur, solange das
 * Mitglied Mitglied bleibt (regelmäßige Prüfung), und bricht nach einer Datenbank-Unterbrechung mit `resync` zum Neuladen auf.
 */
@Injectable()
export class RealtimeService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger('Realtime');
  private readonly abos = new Set<Abonnement>();
  private client: Client | null = null;
  private beendet = false;
  private warVerbunden = false;
  private neuTimer: NodeJS.Timeout | null = null;
  private herzschlag: NodeJS.Timeout | null = null;
  private pruefung: NodeJS.Timeout | null = null;

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(MEMBERSHIP_REPOSITORY) private readonly mitgliedschaften: MembershipRepository
  ) {}

  get aktiv(): boolean {
    return this.config.realtime.enabled;
  }

  async onModuleInit(): Promise<void> {
    if (!this.aktiv) return;
    this.herzschlag = setInterval(() => this.sende('', ': ping\n\n'), this.config.realtime.heartbeatMs);
    this.pruefung = setInterval(() => void this.mitgliedschaftenPruefen(), this.config.realtime.recheckMs);
    this.herzschlag.unref();
    this.pruefung.unref();
    await this.verbinden();
  }

  async onModuleDestroy(): Promise<void> {
    this.beendet = true;
    for (const t of [this.herzschlag, this.pruefung, this.neuTimer]) if (t) clearTimeout(t);
    for (const abo of [...this.abos]) this.schliessen(abo);
    const client = this.client;
    this.client = null;
    await client?.end().catch(() => undefined);
  }

  private async verbinden(): Promise<void> {
    if (this.beendet) return;
    const client = new Client({ connectionString: this.config.databaseUrl });
    client.on('notification', (n) => this.verteilen(n));
    client.on('error', (fehler) => this.logger.warn(`Verbindung gestört: ${fehler.message}`));
    client.once('end', () => {
      if (this.client === client) this.client = null;
      this.neuVerbinden();
    });
    try {
      await client.connect();
      await client.query(`LISTEN ${CHANGES_CHANNEL}`);
      this.client = client;
      // Nach einer Unterbrechung können Meldungen fehlen: Clients laden alles neu.
      if (this.warVerbunden) this.sende('', 'event: resync\ndata: {}\n\n');
      this.warVerbunden = true;
    } catch (fehler) {
      this.logger.warn(`Verbindung fehlgeschlagen: ${fehler instanceof Error ? fehler.message : 'unbekannt'}`);
      await client.end().catch(() => undefined);
      this.neuVerbinden();
    }
  }

  private neuVerbinden(): void {
    if (this.beendet || this.neuTimer) return;
    this.neuTimer = setTimeout(() => {
      this.neuTimer = null;
      void this.verbinden();
    }, 1000);
    this.neuTimer.unref();
  }

  private verteilen(n: Notification): void {
    if (n.channel !== CHANGES_CHANNEL || !n.payload) return;
    let ereignis: ChangeEvent;
    try {
      ereignis = JSON.parse(n.payload) as ChangeEvent;
    } catch {
      return;
    }
    if (!ereignis.organizationId) return;
    const text = `event: change\ndata: ${JSON.stringify({ table: ereignis.table, operation: ereignis.operation, id: ereignis.id })}\n\n`;
    for (const abo of this.abos) {
      if (abo.orgId === ereignis.organizationId && (!abo.tabellen || abo.tabellen.has(ereignis.table))) this.schreibe(abo, text);
    }
  }

  /** Sendet an alle Abos (leere Organisation) oder nur an die der Organisation. */
  private sende(orgId: string, text: string): void {
    for (const abo of this.abos) if (!orgId || abo.orgId === orgId) this.schreibe(abo, text);
  }

  private schreibe(abo: Abonnement, text: string): void {
    // Langsame Empfänger kappen statt unbegrenzt Speicher zu puffern
    if (abo.res.writableEnded || abo.res.destroyed || abo.res.writableLength > MAX_PUFFER) return this.schliessen(abo);
    abo.res.write(text);
  }

  private schliessen(abo: Abonnement): void {
    this.abos.delete(abo);
    if (!abo.res.writableEnded) abo.res.end();
  }

  private async mitgliedschaftenPruefen(): Promise<void> {
    for (const abo of [...this.abos]) {
      try {
        if (!(await this.mitgliedschaften.find(abo.userId, abo.orgId))) this.schliessen(abo);
      } catch {
        // Datenbank kurz nicht erreichbar: Abo bleibt bis zur nächsten Prüfung bestehen
      }
    }
  }

  /** Meldet eine Verbindung an; begrenzt Verbindungen je Nutzer und insgesamt. */
  anmelden(abo: Abonnement): () => void {
    const vom = [...this.abos].filter((a) => a.userId === abo.userId).length;
    if (vom >= this.config.realtime.maxPerUser || this.abos.size >= MAX_GESAMT) throw apiFehler(429, 'too_many_streams', 'Zu viele offene Echtzeit-Verbindungen');
    this.abos.add(abo);
    return () => this.abos.delete(abo);
  }
}
