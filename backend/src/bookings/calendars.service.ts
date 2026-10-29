import { Inject, Injectable } from '@nestjs/common';
import type { Pool } from 'pg';

import { schreibeAudit } from '../common/audit';
import { meldeAenderung } from '../common/changes';
import { inTransaction } from '../common/db';
import { konflikt, nichtGefunden, ungueltig, verboten } from '../common/http-error';
import { PG_POOL } from '../infrastructure/postgres/pg.pool';
import type { Membership } from '../tenancy/membership';
import { isAdmin } from '../tenancy/permissions';

import { BookingAccessService, entscheidet, type PlanZeile } from './booking-access.service';
import type { CreateCalendarDto, UpdateCalendarDto } from './dto/booking.dto';
import type { PlanRolle } from './konstanten';
import { berlinUhr } from './zeit';

const SPALTEN = 'c.id, c.organization_id, c.name, c.kind, c.address, c.state, c.window_start, c.window_end, c.all_members_can_request, c.public_view, c.sort_order, c.created_at, c.updated_at';

export interface PlanAntwort extends PlanZeile {
  my_role: PlanRolle | null;
  open_requests: number;
}

@Injectable()
export class CalendarsService {
  constructor(
    @Inject(PG_POOL) private readonly pool: Pool,
    private readonly zugriff: BookingAccessService
  ) {}

  /** Alle Pläne der Organisation (jedes Mitglied sieht jeden Plan lesend) mit der Rolle des Aufrufers. */
  async liste(orgId: string, aufrufer: Membership): Promise<PlanAntwort[]> {
    const admin = isAdmin(aufrufer);
    const { rows } = await this.pool.query<PlanZeile & { rolle: PlanRolle | null; offen: number }>(
      `SELECT ${SPALTEN}, m.role AS rolle,
              (SELECT count(*)::int FROM bookings b WHERE b.calendar_id = c.id AND b.status = 'requested') AS offen
         FROM booking_calendars c
         LEFT JOIN booking_calendar_members m ON m.calendar_id = c.id AND m.member_id = $2
        WHERE c.organization_id = $1
        ORDER BY c.sort_order, c.name`,
      [orgId, aufrufer.member.id]
    );
    return rows.map(({ rolle, offen, ...plan }) => {
      const my_role: PlanRolle | null = admin ? 'lead' : rolle;
      return { ...plan, my_role, open_requests: entscheidet(my_role) ? offen : 0 };
    });
  }

  /** Offene Anfragen über alle Pläne, in denen der Aufrufer entscheiden darf (Badge am Menüpunkt). */
  async offeneAnfragen(orgId: string, aufrufer: Membership): Promise<{ count: number }> {
    const { rows } = await this.pool.query<{ n: number }>(
      `SELECT count(*)::int AS n
         FROM bookings b
        WHERE b.organization_id = $1 AND b.status = 'requested'
          AND ($3::boolean OR EXISTS (SELECT 1 FROM booking_calendar_members m
                                       WHERE m.calendar_id = b.calendar_id AND m.member_id = $2 AND m.role IN ('lead', 'manager')))`,
      [orgId, aufrufer.member.id, isAdmin(aufrufer)]
    );
    return { count: rows[0].n };
  }

  async einzeln(orgId: string, calId: string, aufrufer: Membership): Promise<PlanAntwort> {
    const { plan, rolle } = await this.zugriff.plan(this.pool, orgId, calId, aufrufer);
    const { rows } = await this.pool.query<{ n: number }>("SELECT count(*)::int AS n FROM bookings WHERE calendar_id = $1 AND status = 'requested'", [calId]);
    return { ...plan, my_role: rolle, open_requests: entscheidet(rolle) ? rows[0].n : 0 };
  }

  private pruefeFenster(start: number, ende: number): void {
    if (ende <= start) throw ungueltig('Das Zeitfenster muss mit einer späteren Stunde enden, als es beginnt');
  }

  /** Nur Administratoren legen Pläne an; wer anlegt, ist deren Leitung. */
  async anlegen(userId: string, orgId: string, aufrufer: Membership, eingabe: CreateCalendarDto): Promise<PlanAntwort> {
    if (!isAdmin(aufrufer)) throw verboten();
    const von = eingabe.window_start ?? 8;
    const bis = eingabe.window_end ?? 22;
    this.pruefeFenster(von, bis);
    return inTransaction(this.pool, async (db) => {
      const { rows } = await db.query<PlanZeile>(
        `INSERT INTO booking_calendars (organization_id, name, kind, address, state, window_start, window_end, all_members_can_request, public_view, sort_order)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, COALESCE((SELECT max(sort_order) + 1 FROM booking_calendars WHERE organization_id = $1), 0))
         RETURNING *`,
        [orgId, eingabe.name.trim(), eingabe.kind, eingabe.address?.trim() || null, eingabe.state ?? null, von, bis, eingabe.all_members_can_request ?? false, eingabe.public_view ?? 'none']
      );
      const plan = rows[0];
      await db.query("INSERT INTO booking_calendar_members (organization_id, calendar_id, member_id, role) VALUES ($1, $2, $3, 'lead')", [orgId, plan.id, aufrufer.member.id]);
      await schreibeAudit(db, { table: 'booking_calendars', operation: 'INSERT', recordId: plan.id, newData: plan, performedBy: userId, organizationId: orgId });
      await meldeAenderung(db, { table: 'booking_calendars', organizationId: orgId, operation: 'INSERT', id: plan.id });
      return { ...plan, my_role: 'lead' as const, open_requests: 0 };
    });
  }

  /** Einstellungen des Plans (Name, Art, Adresse, Bundesland, Zeitfenster, Anfragen, öffentliche Anzeige): nur die Leitung. */
  async aendern(userId: string, orgId: string, calId: string, aufrufer: Membership, eingabe: UpdateCalendarDto): Promise<PlanAntwort> {
    return inTransaction(this.pool, async (db) => {
      const { plan: alt, rolle } = await this.zugriff.plan(db, orgId, calId, aufrufer, true);
      if (rolle !== 'lead') throw verboten();
      const neu = {
        name: eingabe.name?.trim() ?? alt.name,
        kind: eingabe.kind ?? alt.kind,
        address: eingabe.address !== undefined ? eingabe.address?.trim() || null : alt.address,
        state: eingabe.state !== undefined ? eingabe.state : alt.state,
        window_start: eingabe.window_start ?? alt.window_start,
        window_end: eingabe.window_end ?? alt.window_end,
        all_members_can_request: eingabe.all_members_can_request ?? alt.all_members_can_request,
        public_view: eingabe.public_view ?? alt.public_view,
      };
      this.pruefeFenster(neu.window_start, neu.window_end);

      if (neu.window_start !== alt.window_start || neu.window_end !== alt.window_end) {
        const { rows } = await db.query<{ starts_at: Date; ends_at: Date }>(
          "SELECT starts_at, ends_at FROM bookings WHERE calendar_id = $1 AND status IN ('requested', 'approved') AND ends_at > now()",
          [calId]
        );
        const ausserhalb = rows.some((b) => {
          const s = berlinUhr(b.starts_at).stunde;
          const eUhr = berlinUhr(b.ends_at);
          const e = eUhr.stunde === 0 && eUhr.minute === 0 ? 24 : eUhr.stunde;
          return s < neu.window_start || s >= neu.window_end || e <= neu.window_start || e > neu.window_end;
        });
        if (ausserhalb) throw konflikt('window_conflict', 'Es gibt noch Belegungen außerhalb des neuen Zeitfensters');
      }
      if (neu.kind === 'item' && alt.kind === 'place') {
        const { rowCount } = await db.query("SELECT 1 FROM bookings WHERE calendar_id = $1 AND event_id IS NOT NULL AND status IN ('requested', 'approved')", [calId]);
        if ((rowCount ?? 0) > 0) throw konflikt('kind_conflict', 'Ein Gegenstand lässt sich nicht mit Terminen verknüpfen, es gibt aber verknüpfte Buchungen');
      }

      const { rows } = await db.query<PlanZeile>(
        `UPDATE booking_calendars SET name = $3, kind = $4, address = $5, state = $6, window_start = $7, window_end = $8,
                all_members_can_request = $9, public_view = $10, updated_at = now()
          WHERE id = $1 AND organization_id = $2 RETURNING *`,
        [calId, orgId, neu.name, neu.kind, neu.address, neu.state, neu.window_start, neu.window_end, neu.all_members_can_request, neu.public_view]
      );
      await schreibeAudit(db, { table: 'booking_calendars', operation: 'UPDATE', recordId: calId, oldData: alt, newData: rows[0], performedBy: userId, organizationId: orgId });
      await meldeAenderung(db, { table: 'booking_calendars', organizationId: orgId, operation: 'UPDATE', id: calId });
      return { ...rows[0], my_role: rolle, open_requests: 0 };
    });
  }

  /** Nur Administratoren löschen Pläne (samt Rollen, Serien und Buchungen). */
  async loeschen(userId: string, orgId: string, calId: string, aufrufer: Membership): Promise<void> {
    if (!isAdmin(aufrufer)) throw verboten();
    await inTransaction(this.pool, async (db) => {
      const { plan } = await this.zugriff.plan(db, orgId, calId, aufrufer, true);
      await db.query('DELETE FROM booking_calendars WHERE id = $1 AND organization_id = $2', [calId, orgId]);
      await schreibeAudit(db, { table: 'booking_calendars', operation: 'DELETE', recordId: calId, oldData: plan, performedBy: userId, organizationId: orgId });
      await meldeAenderung(db, { table: 'booking_calendars', organizationId: orgId, operation: 'DELETE', id: calId });
    });
  }

  // ── Rollen im Plan ──────────────────────────────────────────────────────────

  /** Wer im Plan welche Rolle hat (für die Leitung zum Verwalten). Organisations-Admins stehen nicht darin, sie sind immer Leitung. */
  async mitglieder(orgId: string, calId: string, aufrufer: Membership): Promise<Array<{ member_id: string; name: string; role: PlanRolle }>> {
    const { rolle } = await this.zugriff.plan(this.pool, orgId, calId, aufrufer);
    if (rolle !== 'lead') throw verboten();
    const { rows } = await this.pool.query(
      `SELECT cm.member_id, m.name, cm.role FROM booking_calendar_members cm JOIN members m ON m.id = cm.member_id
        WHERE cm.calendar_id = $1 AND cm.organization_id = $2 ORDER BY m.name`,
      [calId, orgId]
    );
    return rows;
  }

  async setzeMitglied(userId: string, orgId: string, calId: string, aufrufer: Membership, memberId: string, rolle: string) {
    return inTransaction(this.pool, async (db) => {
      const { rolle: meine } = await this.zugriff.plan(db, orgId, calId, aufrufer, true);
      if (meine !== 'lead') throw verboten();
      const ziel = await db.query<{ name: string }>('SELECT name FROM members WHERE id = $1 AND organization_id = $2', [memberId, orgId]);
      if (!ziel.rows[0]) throw ungueltig('Das Mitglied gehört nicht zu dieser Organisation');
      await db.query(
        `INSERT INTO booking_calendar_members (organization_id, calendar_id, member_id, role) VALUES ($1, $2, $3, $4)
         ON CONFLICT (calendar_id, member_id) DO UPDATE SET role = EXCLUDED.role`,
        [orgId, calId, memberId, rolle]
      );
      await schreibeAudit(db, { table: 'booking_calendar_members', operation: 'UPDATE', recordId: calId, newData: { member_id: memberId, role: rolle }, performedBy: userId, organizationId: orgId });
      await meldeAenderung(db, { table: 'booking_calendar_members', organizationId: orgId, operation: 'UPDATE', id: calId });
      return { member_id: memberId, name: ziel.rows[0].name, role: rolle };
    });
  }

  async entferneMitglied(userId: string, orgId: string, calId: string, aufrufer: Membership, memberId: string): Promise<void> {
    await inTransaction(this.pool, async (db) => {
      const { rolle } = await this.zugriff.plan(db, orgId, calId, aufrufer, true);
      if (rolle !== 'lead') throw verboten();
      const { rowCount } = await db.query('DELETE FROM booking_calendar_members WHERE calendar_id = $1 AND member_id = $2 AND organization_id = $3', [calId, memberId, orgId]);
      if (!rowCount) throw nichtGefunden('Rolle im Plan');
      await schreibeAudit(db, { table: 'booking_calendar_members', operation: 'DELETE', recordId: calId, oldData: { member_id: memberId }, performedBy: userId, organizationId: orgId });
      await meldeAenderung(db, { table: 'booking_calendar_members', organizationId: orgId, operation: 'DELETE', id: calId });
    });
  }
}
