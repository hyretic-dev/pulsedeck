import { Inject, Injectable } from '@nestjs/common';
import type { Pool } from 'pg';

import type { Queryable } from '../common/db';
import { nichtGefunden } from '../common/http-error';
import { PG_POOL } from '../infrastructure/postgres/pg.pool';
import type { Membership } from '../tenancy/membership';
import { isAdmin } from '../tenancy/permissions';

import type { PlanRolle } from './konstanten';

export interface PlanZeile {
  id: string;
  organization_id: string;
  name: string;
  kind: 'place' | 'item';
  address: string | null;
  state: string | null;
  window_start: number;
  window_end: number;
  all_members_can_request: boolean;
  public_view: 'none' | 'week' | 'month' | 'year';
  sort_order: number;
  created_at: Date;
  updated_at: Date;
}

export interface PlanZugriff {
  plan: PlanZeile;
  /** Rolle im Plan; Organisations-Admins sind in jedem Plan Leitung. Null = nur lesen. */
  rolle: PlanRolle | null;
}

export const entscheidet = (rolle: PlanRolle | null): boolean => rolle === 'lead' || rolle === 'manager';

export interface Empfaenger {
  id: string;
  name: string;
  email: string;
}

/** Rolle im Belegungsplan und Mailempfänger; Grundlage jeder Rechteprüfung des Moduls. Alles an die Organisation gebunden. */
@Injectable()
export class BookingAccessService {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  /** Plan der Organisation und Rolle des Aufrufers; unbekannte und fremde Pläne sind nicht unterscheidbar (404). */
  async plan(db: Queryable, orgId: string, calId: string, aufrufer: Membership, sperren = false): Promise<PlanZugriff> {
    const { rows } = await db.query<PlanZeile>(`SELECT * FROM booking_calendars WHERE id = $1 AND organization_id = $2${sperren ? ' FOR UPDATE' : ''}`, [calId, orgId]);
    if (!rows[0]) throw nichtGefunden('Belegungsplan');
    return { plan: rows[0], rolle: await this.rolle(db, calId, aufrufer) };
  }

  async rolle(db: Queryable, calId: string, aufrufer: Membership): Promise<PlanRolle | null> {
    if (isAdmin(aufrufer)) return 'lead';
    const { rows } = await db.query<{ role: PlanRolle }>('SELECT role FROM booking_calendar_members WHERE calendar_id = $1 AND member_id = $2', [calId, aufrufer.member.id]);
    return rows[0]?.role ?? null;
  }

  /** Verwaltung und Leitung des Plans samt Organisations-Admins (Empfänger neuer Anfragen). */
  async verwaltung(db: Queryable, orgId: string, calId: string): Promise<Empfaenger[]> {
    const { rows } = await db.query<Empfaenger>(
      `SELECT DISTINCT m.id, m.name, m.email::text AS email
         FROM members m
         JOIN organizations o ON o.id = m.organization_id
         JOIN organization_roles r ON r.id = m.role_id
         LEFT JOIN booking_calendar_members cm ON cm.member_id = m.id AND cm.calendar_id = $2 AND cm.role IN ('lead', 'manager')
        WHERE m.organization_id = $1 AND m.status <> 'Inactive'
          AND (cm.id IS NOT NULL OR m.app_role = 'admin' OR r.is_system_admin OR m.user_id = o.owner_id)`,
      [orgId, calId]
    );
    return rows;
  }

  async mitglied(db: Queryable, orgId: string, memberId: string | null): Promise<Empfaenger | null> {
    if (!memberId) return null;
    const { rows } = await db.query<Empfaenger>('SELECT id, name, email::text AS email FROM members WHERE id = $1 AND organization_id = $2', [memberId, orgId]);
    return rows[0] ?? null;
  }

  /** Arbeitsgruppen des Mitglieds (für die Terminsichtbarkeit verknüpfter Buchungen). */
  async arbeitsgruppen(db: Queryable, memberId: string): Promise<string[]> {
    const { rows } = await db.query<{ working_group_id: string }>(
      `SELECT working_group_id FROM ag_memberships WHERE member_id = $1
       UNION SELECT working_group_id FROM working_group_members WHERE member_id = $1`,
      [memberId]
    );
    return rows.map((r) => r.working_group_id);
  }

  async orgSlug(db: Queryable, orgId: string): Promise<string> {
    const { rows } = await db.query<{ slug: string }>('SELECT slug FROM organizations WHERE id = $1', [orgId]);
    return rows[0]?.slug ?? '';
  }
}
