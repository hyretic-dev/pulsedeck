import { Injectable } from '@nestjs/common';

import { schreibeAudit } from '../common/audit';
import { meldeAenderung } from '../common/changes';
import { istPgFehler, PG_FEHLER, type Queryable } from '../common/db';
import { konflikt, ungueltig, verboten } from '../common/http-error';
import type { Membership } from '../tenancy/membership';

import { BookingAccessService, entscheidet, type PlanZeile } from './booking-access.service';
import { BookingNotifier } from './booking-notifier';
import type { BuchungsStatus } from './konstanten';
import { berlinUhr, endStunde, terminZuBelegung, type Zeitraum } from './zeit';

/** Was die Buchung vom Termin braucht (Datum `JJJJ-MM-TT`, Zeiten `HH:MM`). */
export interface TerminZeit {
  id: string;
  title: string;
  date: string;
  start_time: string;
  end_time: string | null | undefined;
}

export interface LinkKontext {
  userId: string;
  orgId: string;
  aufrufer: Membership;
}

interface AktiveBuchung {
  id: string;
  calendar_id: string;
  status: BuchungsStatus;
  member_id: string | null;
}

/**
 * Verknüpfung von Termin und Belegung: Wer einen Termin vor Ort plant, reserviert den Ort im selben Schritt. Alles läuft in der
 * Transaktion des Termin-Service (E5): ein Konflikt macht den ganzen Vorgang rückgängig. Titel und Öffentlichkeit stehen nur am
 * Termin (die Buchung liest sie per JOIN), hier geht es um Zeit, Status und Plan.
 */
@Injectable()
export class BookingLinkService {
  constructor(
    private readonly zugriff: BookingAccessService,
    private readonly mails: BookingNotifier
  ) {}

  async aktive(db: Queryable, orgId: string, eventId: string, sperren = false): Promise<AktiveBuchung | null> {
    const { rows } = await db.query<AktiveBuchung>(
      `SELECT id, calendar_id, status, member_id FROM bookings
        WHERE event_id = $1 AND organization_id = $2 AND status IN ('requested', 'approved')${sperren ? ' FOR UPDATE' : ''}`,
      [eventId, orgId]
    );
    return rows[0] ?? null;
  }

  /** Name und Adresse des Plans als Ortsangabe des Termins. */
  async ortsangabe(db: Queryable, orgId: string, calId: string, aufrufer: Membership): Promise<string> {
    const { plan } = await this.zugriff.plan(db, orgId, calId, aufrufer);
    return plan.address ? `${plan.name}, ${plan.address}` : plan.name;
  }

  private zeitraum(plan: PlanZeile, t: TerminZeit, leitung: boolean): Zeitraum {
    const z = terminZuBelegung(t.date, t.start_time, t.end_time);
    if (!z) throw ungueltig('Für die Ortsreservierung brauchst du eine Endzeit nach dem Beginn');
    const s = berlinUhr(z.beginn).stunde;
    const e = endStunde(z.ende);
    if (s < plan.window_start || s >= plan.window_end || e <= plan.window_start || e > plan.window_end) {
      throw ungueltig(`„${plan.name}“ ist von ${plan.window_start} bis ${plan.window_end} Uhr buchbar`);
    }
    if (!leitung && z.beginn.getTime() < Date.now()) throw ungueltig('Reservierungen sind nur für die Zukunft möglich');
    return z;
  }

  private async belegt(db: Queryable, calId: string, z: Zeitraum, ausser: string | null): Promise<boolean> {
    const { rowCount } = await db.query(
      "SELECT 1 FROM bookings WHERE calendar_id = $1 AND status = 'approved' AND starts_at < $3 AND ends_at > $2 AND ($4::uuid IS NULL OR id <> $4)",
      [calId, z.beginn, z.ende, ausser]
    );
    return (rowCount ?? 0) > 0;
  }

  /**
   * Reserviert den Plan für einen oder mehrere (Serien-)Termine. Leitung und Verwaltung: sofort angenommen; Buchende: offene Anfrage
   * (Planung). Terminserien mit Ort nur für die Leitung; ist auch nur ein Datum belegt, wird nichts gespeichert und die Antwort nennt
   * die belegten Daten.
   */
  async reserviere(db: Queryable, k: LinkKontext, calId: string, termine: TerminZeit[]): Promise<BuchungsStatus> {
    const { plan, rolle } = await this.zugriff.plan(db, k.orgId, calId, k.aufrufer, true);
    if (plan.kind !== 'place') throw ungueltig('Nur Orte lassen sich mit Terminen verknüpfen');
    if (rolle === null && !plan.all_members_can_request) throw verboten('Anfragen dürfen nur benannte Personen');
    if (termine.length > 1 && rolle !== 'lead') throw verboten('Terminserien mit Ort darf nur die Leitung des Plans anlegen');
    const leitung = entscheidet(rolle);
    const zeitraeume = termine.map((t) => ({ t, z: this.zeitraum(plan, t, leitung) }));

    const belegteTage: string[] = [];
    for (const { t, z } of zeitraeume) if (await this.belegt(db, calId, z, null)) belegteTage.push(t.date);
    if (belegteTage.length) throw konflikt('booking_conflict', `Der Ort ist schon belegt am ${belegteTage.join(', ')}`);

    const status: BuchungsStatus = leitung ? 'approved' : 'requested';
    try {
      for (const { t, z } of zeitraeume) {
        const { rows } = await db.query<{ id: string }>(
          `INSERT INTO bookings (organization_id, calendar_id, member_id, event_id, starts_at, ends_at, status, decided_by, decided_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
          [k.orgId, calId, k.aufrufer.member.id, t.id, z.beginn, z.ende, status, leitung ? k.aufrufer.member.id : null, leitung ? new Date() : null]
        );
        await schreibeAudit(db, { table: 'bookings', operation: 'INSERT', recordId: rows[0].id, newData: { calendar_id: calId, event_id: t.id, status }, performedBy: k.userId, organizationId: k.orgId });
        await meldeAenderung(db, { table: 'bookings', organizationId: k.orgId, operation: 'INSERT', id: rows[0].id });
      }
    } catch (fehler) {
      if (istPgFehler(fehler, PG_FEHLER.AUSSCHLUSS)) throw konflikt('booking_conflict', 'Der Ort ist inzwischen belegt');
      throw fehler;
    }
    if (status === 'requested') {
      const erster = zeitraeume[0];
      await this.mails.neueAnfrage(db, k.orgId, calId, plan.name, { title: erster.t.title, start: erster.z.beginn, ende: erster.z.ende, memberId: k.aufrufer.member.id });
    }
    return status;
  }

  /**
   * Datum oder Uhrzeit des Termins haben sich geändert: Die Buchung zieht mit. Das braucht eine Rolle im Plan. Verwaltung und
   * Leitung: bleibt wie sie ist (angenommen bleibt angenommen), belegt → 409. Buchende: wird wieder eine offene Anfrage.
   */
  async verschiebe(db: Queryable, k: LinkKontext, termin: TerminZeit): Promise<void> {
    const buchung = await this.aktive(db, k.orgId, termin.id, true);
    if (!buchung) return;
    const { plan, rolle } = await this.zugriff.plan(db, k.orgId, buchung.calendar_id, k.aufrufer, true);
    if (rolle === null) throw verboten('Datum und Uhrzeit ändern darf nur, wer im Belegungsplan eine Rolle hat');
    const leitung = entscheidet(rolle);
    const z = this.zeitraum(plan, termin, leitung);
    if (await this.belegt(db, buchung.calendar_id, z, buchung.id)) throw konflikt('booking_conflict', 'Der Ort ist zu dieser Zeit schon belegt');

    const wieder = !leitung && buchung.status === 'approved';
    try {
      await db.query(
        `UPDATE bookings SET starts_at = $2, ends_at = $3, status = $4, decided_by = CASE WHEN $5::boolean THEN NULL ELSE decided_by END,
                decided_at = CASE WHEN $5::boolean THEN NULL ELSE decided_at END, updated_at = now() WHERE id = $1`,
        [buchung.id, z.beginn, z.ende, wieder ? 'requested' : buchung.status, wieder]
      );
    } catch (fehler) {
      if (istPgFehler(fehler, PG_FEHLER.AUSSCHLUSS)) throw konflikt('booking_conflict', 'Der Ort ist inzwischen belegt');
      throw fehler;
    }
    await schreibeAudit(db, { table: 'bookings', operation: 'UPDATE', recordId: buchung.id, newData: { event_id: termin.id, moved: true, status: wieder ? 'requested' : buchung.status }, performedBy: k.userId, organizationId: k.orgId });
    await meldeAenderung(db, { table: 'bookings', organizationId: k.orgId, operation: 'UPDATE', id: buchung.id });
    if (wieder) await this.mails.neueAnfrage(db, k.orgId, buchung.calendar_id, plan.name, { title: termin.title, start: z.beginn, ende: z.ende, memberId: k.aufrufer.member.id });
  }

  /** Ort entfernt oder gewechselt: die alte Buchung wird storniert (bleibt als Verlauf), der Zeitraum ist frei. */
  async entferne(db: Queryable, k: LinkKontext, eventId: string): Promise<void> {
    const buchung = await this.aktive(db, k.orgId, eventId, true);
    if (!buchung) return;
    await db.query("UPDATE bookings SET status = 'cancelled', updated_at = now() WHERE id = $1", [buchung.id]);
    await schreibeAudit(db, { table: 'bookings', operation: 'UPDATE', recordId: buchung.id, newData: { event_id: eventId, status: 'cancelled' }, performedBy: k.userId, organizationId: k.orgId });
    await meldeAenderung(db, { table: 'bookings', organizationId: k.orgId, operation: 'UPDATE', id: buchung.id });
  }
}
