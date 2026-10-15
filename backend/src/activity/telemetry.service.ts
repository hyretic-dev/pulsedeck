import { Inject, Injectable } from '@nestjs/common';
import type { Pool } from 'pg';

import { meldeAenderung } from '../common/changes';
import { nichtGefunden } from '../common/http-error';
import { PG_POOL } from '../infrastructure/postgres/pg.pool';
import type { MembershipRepository } from '../tenancy/membership';
import { MEMBERSHIP_REPOSITORY } from '../tenancy/tenancy.tokens';

const FEEDBACK_SPALTEN = 'id, created_at, type, description, user_id, status, organization_id';

/** Analytics-Ereignisse, Feedback und Presence. Organisationsbezug wird nie vom Client geglaubt, sondern über die Mitgliedschaft geprüft. */
@Injectable()
export class TelemetryService {
  constructor(
    @Inject(PG_POOL) private readonly pool: Pool,
    @Inject(MEMBERSHIP_REPOSITORY) private readonly mitgliedschaften: MembershipRepository
  ) {}

  /** Organisation nur übernehmen, wenn der (angemeldete) Aufrufer dort Mitglied ist; sonst global/anonym. */
  private async pruefeOrganisation(userId: string | undefined, orgId: string | undefined): Promise<string | null> {
    if (!userId || !orgId) return null;
    return (await this.mitgliedschaften.find(userId, orgId)) ? orgId : null;
  }

  async ereignis(userId: string | undefined, e: { event_name: string; meta_data?: Record<string, unknown>; page_path?: string; organization_id?: string }): Promise<void> {
    const meta = JSON.stringify(e.meta_data ?? {});
    if (meta.length > 2000) return; // Telemetrie darf nie stören und nie Speicher füllen
    await this.pool.query('INSERT INTO analytics_events (event_name, meta_data, page_path, organization_id) VALUES ($1, $2, $3, $4)', [
      e.event_name,
      meta,
      e.page_path ?? null,
      await this.pruefeOrganisation(userId, e.organization_id),
    ]);
  }

  async feedbackEinreichen(userId: string | undefined, e: { type: string; description: string; organization_id?: string }): Promise<void> {
    const orgId = await this.pruefeOrganisation(userId, e.organization_id);
    const { rows } = await this.pool.query('INSERT INTO feedback_submissions (type, description, user_id, status, organization_id) VALUES ($1, $2, $3, $4, $5) RETURNING id', [
      e.type,
      e.description.trim(),
      userId ?? null,
      'new',
      orgId,
    ]);
    if (orgId) await meldeAenderung(this.pool, { table: 'feedback_submissions', organizationId: orgId, operation: 'INSERT', id: rows[0].id });
  }

  async feedbackListe(orgId: string | null, grenzen: { limit?: number; offset?: number }): Promise<Record<string, unknown>[]> {
    const { rows } = await this.pool.query(
      `SELECT ${FEEDBACK_SPALTEN} FROM feedback_submissions WHERE ($1::uuid IS NULL OR organization_id = $1) ORDER BY created_at DESC LIMIT $2 OFFSET $3`,
      [orgId, grenzen.limit ?? 100, grenzen.offset ?? 0]
    );
    return rows;
  }

  async feedbackStatus(orgId: string | null, id: string, status: string): Promise<Record<string, unknown>> {
    const { rows } = await this.pool.query(
      `UPDATE feedback_submissions SET status = $3 WHERE id = $1 AND ($2::uuid IS NULL OR organization_id = $2) RETURNING ${FEEDBACK_SPALTEN}`,
      [id, orgId, status]
    );
    if (!rows[0]) throw nichtGefunden('Feedback');
    if (rows[0].organization_id) await meldeAenderung(this.pool, { table: 'feedback_submissions', organizationId: rows[0].organization_id, operation: 'UPDATE', id });
    return rows[0];
  }

  /** Statistik der Ereignisse (serverseitig gezählt statt alle Zeilen in den Browser zu laden). */
  async ereignisStatistik(orgId: string | null): Promise<Array<{ name: string; count: number }>> {
    const { rows } = await this.pool.query(
      'SELECT event_name AS name, count(*)::int AS count FROM analytics_events WHERE ($1::uuid IS NULL OR organization_id = $1) GROUP BY event_name ORDER BY count DESC, name ASC LIMIT 200',
      [orgId]
    );
    return rows;
  }

  async letzteEreignisse(orgId: string, limit = 50): Promise<Record<string, unknown>[]> {
    const { rows } = await this.pool.query(
      'SELECT id, event_name, organization_id, page_path, meta_data, created_at FROM analytics_events WHERE organization_id = $1 ORDER BY created_at DESC LIMIT $2',
      [orgId, limit]
    );
    return rows;
  }

  // ── Presence ────────────────────────────────────────────────────────────────

  /** Name und Rollen je Organisation stammen vom Server (Mitgliedschaften), nur der Pfad vom Client. */
  async anwesenheit(userId: string, pfad: string): Promise<void> {
    const { rows } = await this.pool.query<{ organization_id: string; app_role: string; name: string }>('SELECT organization_id, app_role, name FROM members WHERE user_id = $1 ORDER BY created_at', [userId]);
    if (rows.length === 0) return;
    await this.pool.query(
      `INSERT INTO active_sessions (user_id, name, org_roles, current_path, last_seen_at) VALUES ($1, $2, $3, $4, now())
       ON CONFLICT (user_id) DO UPDATE SET name = EXCLUDED.name, org_roles = EXCLUDED.org_roles, current_path = EXCLUDED.current_path, last_seen_at = now()`,
      [userId, rows[0].name, JSON.stringify(Object.fromEntries(rows.map((r) => [r.organization_id, r.app_role]))), pfad]
    );
  }

  /** Online = in den letzten fünf Minuten gesehen. Ohne Organisation: alle (nur Plattformadministration). */
  async online(orgId: string | null): Promise<Array<{ user_id: string; name: string; org_roles: Record<string, string>; current_path: string | null; last_seen_at: string }>> {
    const { rows } = await this.pool.query(
      `SELECT user_id, name, ${orgId ? "jsonb_build_object($1::text, org_roles -> $1::text)" : 'org_roles'} AS org_roles, current_path, last_seen_at
         FROM active_sessions WHERE last_seen_at >= now() - interval '5 minutes' AND ($1::text IS NULL OR org_roles ? $1::text) ORDER BY last_seen_at DESC LIMIT 500`,
      [orgId]
    );
    return rows;
  }
}
