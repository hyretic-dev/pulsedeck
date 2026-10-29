import { Inject, Injectable } from '@nestjs/common';
import type { Pool } from 'pg';

import { schreibeAudit } from '../common/audit';
import { meldeAenderung } from '../common/changes';
import { inTransaction, istPgFehler, PG_FEHLER, type Queryable } from '../common/db';
import { konflikt, nichtGefunden, ungueltig, verboten } from '../common/http-error';
import { PG_POOL } from '../infrastructure/postgres/pg.pool';
import type { Membership } from '../tenancy/membership';

import { BookingAccessService, type PlanZeile } from './booking-access.service';
import { BookingNotifier } from './booking-notifier';
import type { SeriesDto } from './dto/booking.dto';
import { feiertageImJahr, type Bundesland } from './feiertage';
import { GRUND_ANDERWEITIG_VERGEBEN } from './konstanten';
import { tageDerSerie } from './serie';
import { berlinZeitpunkt } from './zeit';

export interface AbgelehnteAnfrage {
  id: string;
  title: string | null;
  requester_name: string | null;
  start_at: Date;
  end_at: Date;
}

export interface SerienVorschau {
  dates: string[];
  skipped_booked: string[];
  skipped_holidays: string[];
  declined_requests: AbgelehnteAnfrage[];
}

interface Beruehrt extends AbgelehnteAnfrage {
  status: 'requested' | 'approved';
  member_id: string | null;
}

const teile = (datum: string) => datum.split('-').map(Number) as [number, number, number];

/** Serien (nur Leitung): wöchentlicher Rhythmus, Feiertage auslassen, sofort angenommen, Vorschau vor dem Speichern. */
@Injectable()
export class SeriesService {
  constructor(
    @Inject(PG_POOL) private readonly pool: Pool,
    private readonly zugriff: BookingAccessService,
    private readonly mails: BookingNotifier
  ) {}

  private async pruefe(db: Queryable, plan: PlanZeile, s: SeriesDto): Promise<void> {
    if (s.hour_to <= s.hour_from) throw ungueltig('Das Ende muss nach dem Beginn liegen');
    if (s.hour_from < plan.window_start || s.hour_to > plan.window_end) throw ungueltig(`Die Uhrzeit liegt im Zeitfenster ${plan.window_start}–${plan.window_end} Uhr`);
    if (new Set(s.weekdays).size !== s.weekdays.length) throw ungueltig('Wochentage doppelt angegeben');
    const { rows } = await db.query<{ ok: boolean }>(
      "SELECT ($2::date >= $1::date AND $2::date <= ($1::date + interval '12 months')::date) AS ok",
      [s.valid_from, s.valid_to]
    );
    if (!rows[0].ok) throw ungueltig('Eine Serie gilt höchstens 12 Monate, „gültig bis“ liegt nicht vor „gültig von“');
  }

  private async rechne(db: Queryable, plan: PlanZeile, s: SeriesDto): Promise<{ vorschau: SerienVorschau; beruehrt: Beruehrt[]; zeitraeume: Map<string, { beginn: Date; ende: Date }> }> {
    const tage = tageDerSerie(s);
    const [vj, vm, vt] = teile(s.valid_from);
    const [bj, bm, bt] = teile(s.valid_to);
    const { rows } = await db.query<Beruehrt>(
      `SELECT b.id, COALESCE(b.title, e.title) AS title, m.name AS requester_name, b.starts_at AS start_at, b.ends_at AS end_at, b.status, b.member_id
         FROM bookings b
         LEFT JOIN events e ON e.id = b.event_id AND e.organization_id = b.organization_id
         LEFT JOIN members m ON m.id = b.member_id AND m.organization_id = b.organization_id
        WHERE b.calendar_id = $1 AND b.status IN ('requested', 'approved') AND b.starts_at < $3 AND b.ends_at > $2`,
      [plan.id, berlinZeitpunkt(vj, vm, vt, 0), berlinZeitpunkt(bj, bm, bt + 1, 0)]
    );
    const feiertage = new Map<number, ReadonlyMap<string, string>>();
    const vorschau: SerienVorschau = { dates: [], skipped_booked: [], skipped_holidays: [], declined_requests: [] };
    const beruehrt: Beruehrt[] = [];
    const zeitraeume = new Map<string, { beginn: Date; ende: Date }>();
    for (const datum of tage) {
      const [j, m, t] = teile(datum);
      if (s.skip_holidays) {
        if (!feiertage.has(j)) feiertage.set(j, feiertageImJahr(j, plan.state as Bundesland | null));
        if (feiertage.get(j)?.has(datum)) {
          vorschau.skipped_holidays.push(datum);
          continue;
        }
      }
      const zeitraum = { beginn: berlinZeitpunkt(j, m, t, s.hour_from), ende: berlinZeitpunkt(j, m, t, s.hour_to) };
      const treffer = rows.filter((b) => b.start_at < zeitraum.ende && b.end_at > zeitraum.beginn);
      if (treffer.some((b) => b.status === 'approved')) {
        vorschau.skipped_booked.push(datum);
        continue;
      }
      vorschau.dates.push(datum);
      zeitraeume.set(datum, zeitraum);
      for (const offen of treffer) if (!beruehrt.some((x) => x.id === offen.id)) beruehrt.push(offen);
    }
    vorschau.declined_requests = beruehrt.map(({ id, title, requester_name, start_at, end_at }) => ({ id, title, requester_name, start_at, end_at }));
    return { vorschau, beruehrt, zeitraeume };
  }

  async vorschau(orgId: string, calId: string, aufrufer: Membership, s: SeriesDto): Promise<SerienVorschau> {
    const { plan, rolle } = await this.zugriff.plan(this.pool, orgId, calId, aufrufer);
    if (rolle !== 'lead') throw verboten('Serien legt nur die Leitung an');
    await this.pruefe(this.pool, plan, s);
    return (await this.rechne(this.pool, plan, s)).vorschau;
  }

  /** Legt die Serie und alle Termine in einer Transaktion an; belegte Daten werden übersprungen, überschneidende offene Anfragen abgelehnt. */
  async anlegen(userId: string, orgId: string, calId: string, aufrufer: Membership, s: SeriesDto) {
    try {
      return await inTransaction(this.pool, async (db) => {
        const { plan, rolle } = await this.zugriff.plan(db, orgId, calId, aufrufer, true);
        if (rolle !== 'lead') throw verboten('Serien legt nur die Leitung an');
        await this.pruefe(db, plan, s);
        const { vorschau, beruehrt, zeitraeume } = await this.rechne(db, plan, s);
        if (vorschau.dates.length === 0) throw ungueltig('Die Serie ergibt keinen einzigen freien Termin');

        const serie = await db.query<{ id: string }>(
          `INSERT INTO booking_series (organization_id, calendar_id, member_id, title, note, is_public, weekdays, every_n_weeks, hour_from, hour_to, valid_from, valid_to, skip_holidays)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13) RETURNING id`,
          [orgId, calId, aufrufer.member.id, s.title.trim(), s.note?.trim() || null, s.is_public, [...s.weekdays].sort((a, b) => a - b), s.every_n_weeks, s.hour_from, s.hour_to, s.valid_from, s.valid_to, s.skip_holidays]
        );
        const serienId = serie.rows[0].id;

        // Offene Anfragen im Zeitraum der Serie werden abgelehnt (die Serie hat Vorrang, Entscheidung der Leitung)
        const offen = beruehrt.filter((b) => b.status === 'requested');
        if (offen.length) {
          await db.query(
            "UPDATE bookings SET status = 'declined', decided_by = $2, decided_at = now(), decision_reason = $3, updated_at = now() WHERE id = ANY($1::uuid[])",
            [offen.map((o) => o.id), aufrufer.member.id, GRUND_ANDERWEITIG_VERGEBEN]
          );
          for (const o of offen) {
            await schreibeAudit(db, { table: 'bookings', operation: 'UPDATE', recordId: o.id, newData: { status: 'declined', decision_reason: GRUND_ANDERWEITIG_VERGEBEN }, performedBy: userId, organizationId: orgId });
            await this.mails.entscheidung(db, orgId, plan.name, { title: o.title ?? 'Belegung', start: o.start_at, ende: o.end_at, memberId: o.member_id }, 'automatisch_abgelehnt', null, aufrufer.member.id);
          }
        }

        const termine = vorschau.dates.map((d) => zeitraeume.get(d) as { beginn: Date; ende: Date });
        await db.query(
          `INSERT INTO bookings (organization_id, calendar_id, member_id, title, note, starts_at, ends_at, status, is_public, series_id, decided_by, decided_at)
           SELECT $1, $2, $3, $4, $5, s, e, 'approved', $6, $7, $3, now() FROM unnest($8::timestamptz[], $9::timestamptz[]) AS t(s, e)`,
          [orgId, calId, aufrufer.member.id, s.title.trim(), s.note?.trim() || null, s.is_public, serienId, termine.map((t) => t.beginn), termine.map((t) => t.ende)]
        );
        await schreibeAudit(db, {
          table: 'booking_series', operation: 'INSERT', recordId: serienId,
          newData: { ...s, created: termine.length, skipped_booked: vorschau.skipped_booked, skipped_holidays: vorschau.skipped_holidays, declined: offen.map((o) => o.id) },
          performedBy: userId, organizationId: orgId,
        });
        await meldeAenderung(db, { table: 'booking_series', organizationId: orgId, operation: 'INSERT', id: serienId });
        await meldeAenderung(db, { table: 'bookings', organizationId: orgId, operation: 'INSERT', id: serienId });
        return {
          series_id: serienId,
          created: termine.length,
          skipped_booked: vorschau.skipped_booked,
          skipped_holidays: vorschau.skipped_holidays,
          declined_requests: offen.length,
        };
      });
    } catch (fehler) {
      if (istPgFehler(fehler, PG_FEHLER.AUSSCHLUSS)) throw konflikt('booking_conflict', 'Ein Termin der Serie wurde inzwischen belegt');
      throw fehler;
    }
  }

  private async lade(db: Queryable, orgId: string, serienId: string) {
    const { rows } = await db.query<{ id: string; calendar_id: string; valid_from: string; valid_to: string }>(
      "SELECT id, calendar_id, to_char(valid_from, 'YYYY-MM-DD') AS valid_from, to_char(valid_to, 'YYYY-MM-DD') AS valid_to FROM booking_series WHERE id = $1 AND organization_id = $2 FOR UPDATE",
      [serienId, orgId]
    );
    if (!rows[0]) throw nichtGefunden('Serie');
    return rows[0];
  }

  async umbenennen(userId: string, orgId: string, serienId: string, aufrufer: Membership, titel: string): Promise<{ title: string }> {
    return inTransaction(this.pool, async (db) => {
      const serie = await this.lade(db, orgId, serienId);
      const { rolle } = await this.zugriff.plan(db, orgId, serie.calendar_id, aufrufer, true);
      if (rolle !== 'lead') throw verboten();
      await db.query('UPDATE booking_series SET title = $2 WHERE id = $1', [serienId, titel.trim()]);
      await db.query("UPDATE bookings SET title = $2, updated_at = now() WHERE series_id = $1 AND status IN ('requested', 'approved')", [serienId, titel.trim()]);
      await schreibeAudit(db, { table: 'booking_series', operation: 'UPDATE', recordId: serienId, newData: { title: titel.trim() }, performedBy: userId, organizationId: orgId });
      await meldeAenderung(db, { table: 'booking_series', organizationId: orgId, operation: 'UPDATE', id: serienId });
      await meldeAenderung(db, { table: 'bookings', organizationId: orgId, operation: 'UPDATE', id: serienId });
      return { title: titel.trim() };
    });
  }

  /** Beendet die Serie ab einem Datum (einschließlich): spätere Termine entfallen. */
  async beenden(userId: string, orgId: string, serienId: string, aufrufer: Membership, ab: string): Promise<{ removed: number }> {
    return inTransaction(this.pool, async (db) => {
      const serie = await this.lade(db, orgId, serienId);
      const { rolle } = await this.zugriff.plan(db, orgId, serie.calendar_id, aufrufer, true);
      if (rolle !== 'lead') throw verboten();
      const [j, m, t] = teile(ab);
      const entfernt = await db.query('DELETE FROM bookings WHERE series_id = $1 AND organization_id = $2 AND starts_at >= $3', [serienId, orgId, berlinZeitpunkt(j, m, t, 0)]);
      if (ab <= serie.valid_from) {
        await db.query('DELETE FROM booking_series WHERE id = $1', [serienId]);
      } else {
        await db.query("UPDATE booking_series SET valid_to = LEAST(valid_to, ($2::date - 1)) WHERE id = $1", [serienId, ab]);
      }
      await schreibeAudit(db, { table: 'booking_series', operation: 'UPDATE', recordId: serienId, newData: { ended_from: ab, removed: entfernt.rowCount }, performedBy: userId, organizationId: orgId });
      await meldeAenderung(db, { table: 'booking_series', organizationId: orgId, operation: 'UPDATE', id: serienId });
      await meldeAenderung(db, { table: 'bookings', organizationId: orgId, operation: 'DELETE', id: serienId });
      return { removed: entfernt.rowCount ?? 0 };
    });
  }
}
