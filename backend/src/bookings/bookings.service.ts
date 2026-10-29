import { Inject, Injectable } from '@nestjs/common';
import type { Pool } from 'pg';

import { schreibeAudit } from '../common/audit';
import { meldeAenderung } from '../common/changes';
import { inTransaction, istPgFehler, PG_FEHLER, type Queryable } from '../common/db';
import { konflikt, nichtGefunden, ungueltig, verboten } from '../common/http-error';
import { PG_POOL } from '../infrastructure/postgres/pg.pool';
import { sichtbarkeitsAusdruck, sichtbarkeitsRang } from '../events/visibility';
import type { Membership } from '../tenancy/membership';

import { BookingAccessService, entscheidet, type PlanZeile } from './booking-access.service';
import { BookingNotifier } from './booking-notifier';
import type { CreateBookingDto, UpdateBookingDto } from './dto/booking.dto';
import { GRUND_ANDERWEITIG_VERGEBEN, MAX_DAUER_TAGE, type BuchungsStatus, type PlanRolle } from './konstanten';
import { berlinUhr, endStunde, type Zeitraum } from './zeit';

export interface BuchungAntwort {
  id: string;
  plan_id: string;
  /** Null = Titel nicht sichtbar, die Oberfläche zeigt „Belegt“. */
  title: string | null;
  note: string | null;
  start_at: Date;
  end_at: Date;
  status: BuchungsStatus;
  is_public: boolean;
  requester_name: string | null;
  is_mine: boolean;
  series_id: string | null;
  event_id: string | null;
  decision_reason: string | null;
}

interface Zeile {
  id: string;
  plan_id: string;
  member_id: string | null;
  title_roh: string | null;
  note: string | null;
  starts_at: Date;
  ends_at: Date;
  status: BuchungsStatus;
  is_public: boolean;
  requester_roh: string | null;
  is_mine: boolean;
  series_id: string | null;
  event_id: string | null;
  decision_reason: string | null;
  event_sichtbar: boolean;
}

const LESE_SQL = `
  SELECT b.id, b.calendar_id AS plan_id, b.member_id, COALESCE(e.title, b.title) AS title_roh, b.note, b.starts_at, b.ends_at, b.status,
         CASE WHEN b.event_id IS NOT NULL THEN COALESCE('public' = ANY(e.allowed_roles), false) ELSE b.is_public END AS is_public,
         m.name AS requester_roh, (b.member_id IS NOT NULL AND b.member_id = $2) AS is_mine, b.series_id, b.event_id, b.decision_reason,
         (b.event_id IS NOT NULL AND ${sichtbarkeitsAusdruck('$3::int', '$4::uuid[]')}) AS event_sichtbar
    FROM bookings b
    LEFT JOIN events e ON e.id = b.event_id AND e.organization_id = b.organization_id
    LEFT JOIN members m ON m.id = b.member_id AND m.organization_id = b.organization_id`;

/** Anfragen, Buchungen und Entscheidungen. Rechte je Plan (Leitung, Verwaltung, Buchende), jede Abfrage an die Organisation gebunden. */
@Injectable()
export class BookingsService {
  constructor(
    @Inject(PG_POOL) private readonly pool: Pool,
    private readonly zugriff: BookingAccessService,
    private readonly mails: BookingNotifier
  ) {}

  // ── Lesen ───────────────────────────────────────────────────────────────────

  /**
   * Buchungen lesen. Titel, Notiz und Person sieht, wer die Buchung selbst gemacht hat, Verwaltung und Leitung,
   * bei verknüpften Buchungen wer den Termin sehen darf, sonst wer eine Rolle im Plan hat; angenommene öffentliche Buchungen
   * sieht jedes Mitglied. Abgelehnte und stornierte Anfragen sehen nur die Person selbst, Verwaltung und Leitung.
   */
  async lese(db: Queryable, orgId: string, aufrufer: Membership, rolle: PlanRolle | null, bedingung: string, werte: unknown[]): Promise<BuchungAntwort[]> {
    const leitung = entscheidet(rolle);
    const { rows } = await db.query<Zeile>(
      `${LESE_SQL} WHERE b.organization_id = $1 AND (b.status IN ('requested', 'approved') OR b.member_id = $2 OR $5::boolean) AND ${bedingung} ORDER BY b.starts_at, b.created_at`,
      [orgId, aufrufer.member.id, sichtbarkeitsRang(aufrufer), await this.zugriff.arbeitsgruppen(db, aufrufer.member.id), leitung, ...werte]
    );
    return rows.map((z) => {
      const darfTitel = z.is_mine || leitung || (z.event_id ? z.event_sichtbar : rolle !== null) || (z.status === 'approved' && z.is_public);
      return {
        id: z.id,
        plan_id: z.plan_id,
        title: darfTitel ? z.title_roh : null,
        note: darfTitel ? z.note : null,
        start_at: z.starts_at,
        end_at: z.ends_at,
        status: z.status,
        is_public: z.is_public,
        requester_name: darfTitel ? z.requester_roh : null,
        is_mine: z.is_mine,
        series_id: z.series_id,
        event_id: z.event_id,
        decision_reason: z.is_mine || leitung ? z.decision_reason : null,
      };
    });
  }

  async liste(orgId: string, calId: string, aufrufer: Membership, von: string, bis: string): Promise<BuchungAntwort[]> {
    const { rolle } = await this.zugriff.plan(this.pool, orgId, calId, aufrufer);
    // `bis` ist ein Datum und gilt einschließlich; Grenzen als Berliner Tage
    return this.lese(
      this.pool, orgId, aufrufer, rolle,
      "b.calendar_id = $6 AND b.starts_at < (($8::date + 1)::timestamp AT TIME ZONE 'Europe/Berlin') AND b.ends_at > ($7::date::timestamp AT TIME ZONE 'Europe/Berlin')",
      [calId, von, bis]
    );
  }

  private async einzeln(db: Queryable, orgId: string, aufrufer: Membership, rolle: PlanRolle | null, id: string): Promise<BuchungAntwort> {
    const [buchung] = await this.lese(db, orgId, aufrufer, rolle, 'b.id = $6', [id]);
    if (!buchung) throw nichtGefunden('Buchung');
    return buchung;
  }

  /** Verfügbarkeit eines Zeitraums für den Termin-Dialog: frei, Überschneidung mit Anfragen (Planung) oder belegt. */
  async verfuegbarkeit(orgId: string, calId: string, aufrufer: Membership, startAt: string, endAt: string) {
    const { plan, rolle } = await this.zugriff.plan(this.pool, orgId, calId, aufrufer);
    const zeitraum = this.pruefeZeitraum(plan, startAt, endAt, true);
    const treffer = await this.lese(
      this.pool, orgId, aufrufer, rolle,
      "b.calendar_id = $6 AND b.status IN ('requested', 'approved') AND b.starts_at < $8 AND b.ends_at > $7",
      [calId, zeitraum.beginn, zeitraum.ende]
    );
    const belegt = treffer.some((t) => t.status === 'approved');
    return { status: belegt ? 'booked' : treffer.length ? 'overlap' : 'free', conflicts: treffer };
  }

  // ── Zeiträume ───────────────────────────────────────────────────────────────

  /** Volle Stunden, Ende nach Beginn, höchstens 14 Tage, im Zeitfenster des Plans; Buchende nur für die Zukunft. */
  pruefeZeitraum(plan: Pick<PlanZeile, 'window_start' | 'window_end'>, startAt: string, endAt: string, leitung: boolean): Zeitraum {
    const beginn = new Date(startAt);
    const ende = new Date(endAt);
    if (Number.isNaN(beginn.getTime()) || Number.isNaN(ende.getTime())) throw ungueltig('Ungültiger Zeitraum');
    if (beginn.getTime() % 3_600_000 !== 0 || ende.getTime() % 3_600_000 !== 0) throw ungueltig('Beginn und Ende sind volle Stunden');
    if (ende <= beginn) throw ungueltig('Das Ende muss nach dem Beginn liegen');
    if (ende.getTime() - beginn.getTime() > MAX_DAUER_TAGE * 86_400_000) throw ungueltig(`Eine Belegung dauert höchstens ${MAX_DAUER_TAGE} Tage`);
    const s = berlinUhr(beginn).stunde;
    const e = endStunde(ende);
    if (s < plan.window_start || s >= plan.window_end || e <= plan.window_start || e > plan.window_end) {
      throw ungueltig(`Beginn und Ende liegen im Zeitfenster ${plan.window_start}–${plan.window_end} Uhr`);
    }
    if (!leitung && beginn.getTime() < Date.now()) throw ungueltig('Anfragen sind nur für die Zukunft möglich');
    return { beginn, ende };
  }

  /** Angenommene Buchungen, die den Zeitraum belegen. */
  private async belegungen(db: Queryable, calId: string, z: Zeitraum, ausser: string | null): Promise<string[]> {
    const { rows } = await db.query<{ id: string }>(
      "SELECT id FROM bookings WHERE calendar_id = $1 AND status = 'approved' AND starts_at < $3 AND ends_at > $2 AND ($4::uuid IS NULL OR id <> $4)",
      [calId, z.beginn, z.ende, ausser]
    );
    return rows.map((r) => r.id);
  }

  private konfliktFehler() {
    return konflikt('booking_conflict', 'Der Zeitraum ist schon belegt');
  }

  // ── Anlegen ─────────────────────────────────────────────────────────────────

  /**
   * Verwaltung und Leitung tragen direkt ein (gilt sofort); alle anderen mit Rolle im Plan (oder wenn alle Mitglieder
   * anfragen dürfen) stellen eine Anfrage. Belegt der Zeitraum, antwortet `409 booking_conflict`.
   */
  async anlegen(userId: string, orgId: string, calId: string, aufrufer: Membership, eingabe: CreateBookingDto): Promise<BuchungAntwort> {
    try {
      return await inTransaction(this.pool, async (db) => {
        const { plan, rolle } = await this.zugriff.plan(db, orgId, calId, aufrufer, true);
        if (rolle === null && !plan.all_members_can_request) throw verboten('Anfragen dürfen nur benannte Personen');
        const leitung = entscheidet(rolle);
        const zeitraum = this.pruefeZeitraum(plan, eingabe.start_at, eingabe.end_at, leitung);
        if ((await this.belegungen(db, calId, zeitraum, null)).length > 0) throw this.konfliktFehler();
        const status: BuchungsStatus = leitung ? 'approved' : 'requested';
        const { rows } = await db.query<{ id: string }>(
          `INSERT INTO bookings (organization_id, calendar_id, member_id, title, note, starts_at, ends_at, status, is_public, decided_by, decided_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING id`,
          [orgId, calId, aufrufer.member.id, eingabe.title.trim(), eingabe.note?.trim() || null, zeitraum.beginn, zeitraum.ende, status, eingabe.is_public ?? false,
           leitung ? aufrufer.member.id : null, leitung ? new Date() : null]
        );
        const id = rows[0].id;
        const angelegt = await this.einzeln(db, orgId, aufrufer, rolle, id);
        await schreibeAudit(db, { table: 'bookings', operation: 'INSERT', recordId: id, newData: angelegt, performedBy: userId, organizationId: orgId });
        await meldeAenderung(db, { table: 'bookings', organizationId: orgId, operation: 'INSERT', id });
        if (status === 'requested') {
          await this.mails.neueAnfrage(db, orgId, calId, plan.name, { title: eingabe.title.trim(), start: zeitraum.beginn, ende: zeitraum.ende, memberId: aufrufer.member.id });
        }
        return angelegt;
      });
    } catch (fehler) {
      if (istPgFehler(fehler, PG_FEHLER.AUSSCHLUSS)) throw this.konfliktFehler();
      throw fehler;
    }
  }

  // ── Ändern ──────────────────────────────────────────────────────────────────

  /** Verwaltung und Leitung: umbenennen, verschieben, öffentlich/intern schalten. Verknüpfte Buchungen folgen dem Termin. */
  async aendern(userId: string, orgId: string, id: string, aufrufer: Membership, eingabe: UpdateBookingDto): Promise<BuchungAntwort> {
    try {
      return await inTransaction(this.pool, async (db) => {
        const alt = await this.sperren(db, orgId, id);
        const { plan, rolle } = await this.zugriff.plan(db, orgId, alt.calendar_id, aufrufer, true);
        if (!entscheidet(rolle)) throw verboten();
        if (alt.status !== 'requested' && alt.status !== 'approved') throw konflikt('booking_closed', 'Diese Buchung ist abgeschlossen');
        if (alt.event_id) {
          // Titel, Öffentlichkeit und Zeit kommen aus dem Termin
          if (eingabe.title !== undefined || eingabe.start_at !== undefined || eingabe.end_at !== undefined || eingabe.is_public !== undefined) {
            throw konflikt('booking_linked', 'Diese Buchung gehört zu einem Termin: ändere Titel, Zeit und Öffentlichkeit über den Termin');
          }
        }
        const vorher = await this.einzeln(db, orgId, aufrufer, rolle, id);
        const verschiebt = eingabe.start_at !== undefined || eingabe.end_at !== undefined;
        const zeitraum = verschiebt
          ? this.pruefeZeitraum(plan, eingabe.start_at ?? alt.starts_at.toISOString(), eingabe.end_at ?? alt.ends_at.toISOString(), true)
          : { beginn: alt.starts_at, ende: alt.ends_at };
        if (verschiebt && (await this.belegungen(db, alt.calendar_id, zeitraum, id)).length > 0) throw this.konfliktFehler();
        await db.query(
          `UPDATE bookings SET title = COALESCE($3, title), note = CASE WHEN $4::boolean THEN $5 ELSE note END, starts_at = $6, ends_at = $7,
                  is_public = COALESCE($8, is_public), updated_at = now()
            WHERE id = $1 AND organization_id = $2`,
          [id, orgId, eingabe.title?.trim() ?? null, eingabe.note !== undefined, eingabe.note?.trim() || null, zeitraum.beginn, zeitraum.ende, eingabe.is_public ?? null]
        );
        const neu = await this.einzeln(db, orgId, aufrufer, rolle, id);
        await schreibeAudit(db, { table: 'bookings', operation: 'UPDATE', recordId: id, oldData: vorher, newData: neu, performedBy: userId, organizationId: orgId });
        await meldeAenderung(db, { table: 'bookings', organizationId: orgId, operation: 'UPDATE', id });
        return neu;
      });
    } catch (fehler) {
      if (istPgFehler(fehler, PG_FEHLER.AUSSCHLUSS)) throw this.konfliktFehler();
      throw fehler;
    }
  }

  private async sperren(db: Queryable, orgId: string, id: string) {
    const { rows } = await db.query<{ id: string; calendar_id: string; member_id: string | null; status: BuchungsStatus; event_id: string | null; title: string | null; starts_at: Date; ends_at: Date }>(
      `SELECT b.id, b.calendar_id, b.member_id, b.status, b.event_id, COALESCE(e.title, b.title) AS title, b.starts_at, b.ends_at
         FROM bookings b LEFT JOIN events e ON e.id = b.event_id AND e.organization_id = b.organization_id
        WHERE b.id = $1 AND b.organization_id = $2`,
      [id, orgId]
    );
    if (!rows[0]) throw nichtGefunden('Buchung');
    return rows[0];
  }

  // ── Entscheiden ─────────────────────────────────────────────────────────────

  /**
   * Nimmt eine offene Anfrage an und lehnt in derselben Transaktion alle überschneidenden offenen Anfragen ab
   * („Zeitraum anderweitig vergeben“). Der Plan wird gesperrt: bei zwei gleichzeitigen Annahmen gewinnt genau eine, die andere
   * bekommt `409 booking_conflict` (Rückfall: Exclusion Constraint der Datenbank).
   */
  async annehmen(userId: string, orgId: string, id: string, aufrufer: Membership): Promise<BuchungAntwort> {
    try {
      return await inTransaction(this.pool, async (db) => {
        const roh = await this.sperren(db, orgId, id);
        const { plan, rolle } = await this.zugriff.plan(db, orgId, roh.calendar_id, aufrufer, true);
        if (!entscheidet(rolle)) throw verboten();
        const { rows } = await db.query<{ status: BuchungsStatus; starts_at: Date; ends_at: Date }>('SELECT status, starts_at, ends_at FROM bookings WHERE id = $1 FOR UPDATE', [id]);
        const b = rows[0];
        if (b.status !== 'requested') throw konflikt('booking_not_open', 'Die Anfrage ist nicht mehr offen');
        if ((await this.belegungen(db, roh.calendar_id, { beginn: b.starts_at, ende: b.ends_at }, id)).length > 0) throw this.konfliktFehler();

        await db.query("UPDATE bookings SET status = 'approved', decided_by = $2, decided_at = now(), decision_reason = NULL, updated_at = now() WHERE id = $1", [id, aufrufer.member.id]);
        const abgelehnt = await db.query<{ id: string; title: string | null; member_id: string | null; starts_at: Date; ends_at: Date }>(
          `UPDATE bookings x SET status = 'declined', decided_by = $4, decided_at = now(), decision_reason = $5, updated_at = now()
            WHERE x.calendar_id = $2 AND x.organization_id = $1 AND x.status = 'requested' AND x.id <> $3 AND x.starts_at < $7 AND x.ends_at > $6
            RETURNING x.id, COALESCE(x.title, (SELECT e.title FROM events e WHERE e.id = x.event_id)) AS title, x.member_id, x.starts_at, x.ends_at`,
          [orgId, roh.calendar_id, id, aufrufer.member.id, GRUND_ANDERWEITIG_VERGEBEN, b.starts_at, b.ends_at]
        );
        await this.mails.entscheidung(db, orgId, plan.name, { title: roh.title ?? 'Belegung', start: b.starts_at, ende: b.ends_at, memberId: roh.member_id }, 'angenommen', null, aufrufer.member.id);
        for (const a of abgelehnt.rows) {
          await schreibeAudit(db, { table: 'bookings', operation: 'UPDATE', recordId: a.id, newData: { status: 'declined', decision_reason: GRUND_ANDERWEITIG_VERGEBEN }, performedBy: userId, organizationId: orgId });
          await this.mails.entscheidung(db, orgId, plan.name, { title: a.title ?? 'Belegung', start: a.starts_at, ende: a.ends_at, memberId: a.member_id }, 'automatisch_abgelehnt', null, aufrufer.member.id);
          await meldeAenderung(db, { table: 'bookings', organizationId: orgId, operation: 'UPDATE', id: a.id });
        }
        const neu = await this.einzeln(db, orgId, aufrufer, rolle, id);
        await schreibeAudit(db, { table: 'bookings', operation: 'UPDATE', recordId: id, newData: { status: 'approved', declined_overlapping: abgelehnt.rows.map((a) => a.id) }, performedBy: userId, organizationId: orgId });
        await meldeAenderung(db, { table: 'bookings', organizationId: orgId, operation: 'UPDATE', id });
        return neu;
      });
    } catch (fehler) {
      if (istPgFehler(fehler, PG_FEHLER.AUSSCHLUSS)) throw this.konfliktFehler();
      throw fehler;
    }
  }

  async ablehnen(userId: string, orgId: string, id: string, aufrufer: Membership, grund: string | null): Promise<BuchungAntwort> {
    return inTransaction(this.pool, async (db) => {
      const roh = await this.sperren(db, orgId, id);
      const { plan, rolle } = await this.zugriff.plan(db, orgId, roh.calendar_id, aufrufer, true);
      if (!entscheidet(rolle)) throw verboten();
      if (roh.status !== 'requested') throw konflikt('booking_not_open', 'Die Anfrage ist nicht mehr offen');
      const text = grund?.trim() || null;
      await db.query("UPDATE bookings SET status = 'declined', decided_by = $2, decided_at = now(), decision_reason = $3, updated_at = now() WHERE id = $1", [id, aufrufer.member.id, text]);
      await this.mails.entscheidung(db, orgId, plan.name, { title: roh.title ?? 'Belegung', start: roh.starts_at, ende: roh.ends_at, memberId: roh.member_id }, 'abgelehnt', text, aufrufer.member.id);
      const neu = await this.einzeln(db, orgId, aufrufer, rolle, id);
      await schreibeAudit(db, { table: 'bookings', operation: 'UPDATE', recordId: id, newData: { status: 'declined', decision_reason: text }, performedBy: userId, organizationId: orgId });
      await meldeAenderung(db, { table: 'bookings', organizationId: orgId, operation: 'UPDATE', id });
      return neu;
    });
  }

  /** Eigene offene Anfrage zurückziehen oder eigene Buchung stornieren; fremde Buchungen kann nur die Verwaltung löschen. */
  async stornieren(userId: string, orgId: string, id: string, aufrufer: Membership): Promise<BuchungAntwort> {
    return inTransaction(this.pool, async (db) => {
      const roh = await this.sperren(db, orgId, id);
      const { rolle } = await this.zugriff.plan(db, orgId, roh.calendar_id, aufrufer, true);
      if (roh.member_id !== aufrufer.member.id) throw verboten();
      if (roh.status !== 'requested' && roh.status !== 'approved') throw konflikt('booking_closed', 'Diese Buchung ist abgeschlossen');
      await db.query("UPDATE bookings SET status = 'cancelled', updated_at = now() WHERE id = $1", [id]);
      const neu = await this.einzeln(db, orgId, aufrufer, rolle, id);
      await schreibeAudit(db, { table: 'bookings', operation: 'UPDATE', recordId: id, newData: { status: 'cancelled' }, performedBy: userId, organizationId: orgId });
      await meldeAenderung(db, { table: 'bookings', organizationId: orgId, operation: 'UPDATE', id });
      return neu;
    });
  }

  /** Verwaltung und Leitung löschen jede Buchung; die Person bekommt eine Mail (der Termin einer verknüpften Buchung bleibt bestehen). */
  async loeschen(userId: string, orgId: string, id: string, aufrufer: Membership): Promise<void> {
    await inTransaction(this.pool, async (db) => {
      const roh = await this.sperren(db, orgId, id);
      const { plan, rolle } = await this.zugriff.plan(db, orgId, roh.calendar_id, aufrufer, true);
      if (!entscheidet(rolle)) throw verboten();
      const vorher = await this.einzeln(db, orgId, aufrufer, rolle, id);
      await db.query('DELETE FROM bookings WHERE id = $1 AND organization_id = $2', [id, orgId]);
      if (roh.status === 'requested' || roh.status === 'approved') {
        await this.mails.entscheidung(db, orgId, plan.name, { title: roh.title ?? 'Belegung', start: roh.starts_at, ende: roh.ends_at, memberId: roh.member_id }, 'geloescht', null, aufrufer.member.id);
      }
      await schreibeAudit(db, { table: 'bookings', operation: 'DELETE', recordId: id, oldData: vorher, performedBy: userId, organizationId: orgId });
      await meldeAenderung(db, { table: 'bookings', organizationId: orgId, operation: 'DELETE', id });
    });
  }
}
