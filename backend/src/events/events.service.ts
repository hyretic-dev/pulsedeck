import { Inject, Injectable } from '@nestjs/common';
import type { Pool, PoolClient } from 'pg';

import { schreibeAudit } from '../common/audit';
import { meldeAenderung } from '../common/changes';
import { inTransaction } from '../common/db';
import { konflikt, nichtGefunden, ungueltig, verboten } from '../common/http-error';
import { BookingLinkService, type TerminZeit } from '../bookings/booking-link.service';
import { PG_POOL } from '../infrastructure/postgres/pg.pool';
import type { Membership } from '../tenancy/membership';
import { reihePushEin } from '../push/push-queue';
import { hasPermission, isAdmin } from '../tenancy/permissions';

import { sichtbarkeitsBedingung, sichtbarkeitsRang } from './visibility';

export const EVENT_SPALTEN = `e.id, e.organization_id, e.title, e.date, e.start_time, e.end_time, e.location, e.description,
  COALESCE(g.name, e.ag_name) AS ag_name, e.working_group_id, e.allowed_roles, e.max_participants, e.registration_required,
  e.meeting_reason, e.location_type, e.is_recurring, e.recurrence_interval, e.recurrence_parent_id, e.created_at, e.updated_at`;
const EVENT_FROM = 'FROM events e LEFT JOIN working_groups g ON g.id = e.working_group_id';
/** Ortsreservierung des Termins (Plan und Status) für Chips in Liste, Detail und Dashboard; nur für Mitglieder, nie öffentlich. */
const BUCHUNG_SPALTE = `CASE WHEN bk.id IS NULL THEN NULL
       ELSE jsonb_build_object('id', bk.id, 'calendar_id', bk.calendar_id, 'calendar_name', bk.calendar_name, 'status', bk.status) END AS booking`;
const BUCHUNG_JOIN = `LEFT JOIN LATERAL (
    SELECT b.id, b.status, b.calendar_id, c.name AS calendar_name FROM bookings b JOIN booking_calendars c ON c.id = b.calendar_id
     WHERE b.event_id = e.id AND b.organization_id = e.organization_id
     ORDER BY (b.status IN ('requested', 'approved')) DESC, b.updated_at DESC LIMIT 1) bk ON true`;
const MIT_BUCHUNG = `${EVENT_SPALTEN}, ${BUCHUNG_SPALTE}`;
const FROM_MIT_BUCHUNG = `${EVENT_FROM} ${BUCHUNG_JOIN}`;

export interface EventEingabe {
  title?: string;
  date?: string;
  start_time?: string;
  end_time?: string | null;
  location?: string;
  description?: string | null;
  working_group_id?: string | null;
  allowed_roles?: string[];
  max_participants?: number | null;
  registration_required?: boolean;
  meeting_reason?: string | null;
  location_type?: string | null;
  is_recurring?: boolean;
  recurrence_interval?: string | null;
  /** Belegungsplan (Art Ort), der für den Termin reserviert wird; null entfernt die Reservierung. */
  booking_calendar_id?: string | null;
}
const FELDER = [
  'title', 'date', 'start_time', 'end_time', 'location', 'description', 'working_group_id', 'allowed_roles',
  'max_participants', 'registration_required', 'meeting_reason', 'location_type', 'is_recurring', 'recurrence_interval',
] as const;

type Db = Pick<Pool, 'query'> | Pick<PoolClient, 'query'>;

/** `n` Monate nach `start`, am Monatsende abgeschnitten (31.01. + 1 Monat = 28./29.02., nicht 03.03.). */
function plusMonate(start: Date, n: number): Date {
  const ziel = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + n, 1));
  const letzterTag = new Date(Date.UTC(ziel.getUTCFullYear(), ziel.getUTCMonth() + 1, 0)).getUTCDate();
  ziel.setUTCDate(Math.min(start.getUTCDate(), letzterTag));
  return ziel;
}

/** Folgetermine einer Serie: bis sechs Monate nach dem ersten Termin (wie im Bestands-Frontend, ohne Datumsdrift am Monatsende). */
export function serienTermine(startDatum: string, intervall: string): string[] {
  const start = new Date(`${startDatum}T00:00:00Z`);
  const ende = plusMonate(start, 6);
  const termine: string[] = [];
  for (let i = 1; ; i += 1) {
    let aktuell: Date;
    if (intervall === 'biweekly') aktuell = new Date(start.getTime() + i * 14 * 86_400_000);
    else if (intervall === 'monthly') aktuell = plusMonate(start, i);
    else if (intervall === 'quarterly') aktuell = plusMonate(start, 3 * i);
    else break;
    if (aktuell >= ende) break;
    termine.push(aktuell.toISOString().split('T')[0]);
  }
  return termine;
}

@Injectable()
export class EventsService {
  constructor(
    @Inject(PG_POOL) private readonly pool: Pool,
    private readonly buchungen: BookingLinkService
  ) {}

  /** Arbeitsgruppen des Aufrufers (beide Mitgliedschaftstabellen). */
  async agIds(db: Db, memberId: string): Promise<string[]> {
    const { rows } = await db.query<{ working_group_id: string }>(
      `SELECT working_group_id FROM ag_memberships WHERE member_id = $1
       UNION SELECT working_group_id FROM working_group_members WHERE member_id = $1`,
      [memberId]
    );
    return rows.map((r) => r.working_group_id);
  }

  private async istAgLeitung(db: Db, groupId: string, memberId: string): Promise<boolean> {
    const { rowCount } = await db.query("SELECT 1 FROM ag_memberships WHERE working_group_id = $1 AND member_id = $2 AND role IN ('admin', 'lead')", [groupId, memberId]);
    return (rowCount ?? 0) > 0;
  }

  /**
   * Wer Termine anlegen, ändern und löschen darf: Administratoren immer; für AG-Termine die AG-Leitung;
   * für allgemeine Termine das Recht `events:create` (Vorstand hat es implizit).
   */
  async darfVerwalten(db: Db, aufrufer: Membership, workingGroupId: string | null): Promise<boolean> {
    if (isAdmin(aufrufer)) return true;
    if (workingGroupId) return this.istAgLeitung(db, workingGroupId, aufrufer.member.id);
    return hasPermission(aufrufer, 'events:create');
  }

  private async lade(db: Db, orgId: string, eventId: string, aufrufer?: Membership): Promise<Record<string, unknown>> {
    const params: unknown[] = [eventId, orgId];
    let bedingung = '';
    if (aufrufer) {
      params.push(sichtbarkeitsRang(aufrufer), await this.agIds(db, aufrufer.member.id));
      bedingung = `AND ${sichtbarkeitsBedingung(3)}`;
    }
    const { rows } = await db.query(`SELECT ${MIT_BUCHUNG} ${FROM_MIT_BUCHUNG} WHERE e.id = $1 AND e.organization_id = $2 ${bedingung}`, params);
    if (!rows[0]) throw nichtGefunden('Termin');
    return rows[0];
  }

  async liste(orgId: string, aufrufer: Membership): Promise<Record<string, unknown>[]> {
    const { rows } = await this.pool.query(
      `SELECT ${MIT_BUCHUNG} ${FROM_MIT_BUCHUNG}
        WHERE e.organization_id = $1 AND ${sichtbarkeitsBedingung(2)}
        ORDER BY e.date ASC, e.start_time ASC`,
      [orgId, sichtbarkeitsRang(aufrufer), await this.agIds(this.pool, aufrufer.member.id)]
    );
    return rows;
  }

  async einzeln(orgId: string, aufrufer: Membership, eventId: string): Promise<Record<string, unknown>> {
    return this.lade(this.pool, orgId, eventId, aufrufer);
  }

  /** Kommende Termine mit Arbeitsgruppe (für die AG-Übersicht), sichtbar für den Aufrufer. */
  async kommendeAgTermine(orgId: string, aufrufer: Membership): Promise<Record<string, unknown>[]> {
    const heute = new Date().toISOString().split('T')[0];
    const { rows } = await this.pool.query(
      `SELECT ${MIT_BUCHUNG} ${FROM_MIT_BUCHUNG}
        WHERE e.organization_id = $1 AND e.working_group_id IS NOT NULL AND e.date >= $4 AND ${sichtbarkeitsBedingung(2)}
        ORDER BY e.date ASC, e.start_time ASC`,
      [orgId, sichtbarkeitsRang(aufrufer), await this.agIds(this.pool, aufrufer.member.id), heute]
    );
    return rows;
  }

  /** Öffentlicher Termin samt Organisation (Seite /event/:id, auch anonym). Nur Termine mit Rolle `public`. */
  async oeffentlich(eventId: string): Promise<Record<string, unknown>> {
    const { rows } = await this.pool.query(
      `SELECT ${EVENT_SPALTEN}, jsonb_build_object('name', o.name, 'slug', o.slug, 'logo_url', o.logo_url) AS organization
         ${EVENT_FROM} JOIN organizations o ON o.id = e.organization_id
        WHERE e.id = $1 AND 'public' = ANY(e.allowed_roles)`,
      [eventId]
    );
    if (!rows[0]) throw nichtGefunden('Termin');
    return rows[0];
  }

  private async pruefeGruppe(db: Db, orgId: string, groupId: string | null | undefined): Promise<string | null> {
    if (!groupId) return null;
    const { rows } = await db.query<{ name: string }>('SELECT name FROM working_groups WHERE id = $1 AND organization_id = $2', [groupId, orgId]);
    if (!rows[0]) throw ungueltig('Die Arbeitsgruppe gehört nicht zu dieser Organisation');
    return rows[0].name;
  }

  /** Ortsreservierung gibt es nur bei „Vor Ort“ und mit Endzeit (die Buchung umfasst die vollen Stunden um den Termin). */
  private pruefeOrtsreservierung(locationType: string | null | undefined, endTime: string | null | undefined): void {
    if (locationType !== 'onsite') throw ungueltig('Ein Ort lässt sich nur bei „Vor Ort“ reservieren');
    if (!endTime) throw ungueltig('Für die Ortsreservierung brauchst du eine Endzeit');
  }

  /** Legt einen Termin an, bei Serien alle Folgetermine, und reserviert auf Wunsch den Ort: alles in einer Transaktion. */
  async anlegen(userId: string, orgId: string, aufrufer: Membership, eingabe: EventEingabe): Promise<Record<string, unknown>> {
    if (!(await this.darfVerwalten(this.pool, aufrufer, eingabe.working_group_id ?? null))) throw verboten();
    if (eingabe.is_recurring && !eingabe.recurrence_interval) throw ungueltig('Für Serientermine fehlt das Wiederholungsintervall');
    const calId = eingabe.booking_calendar_id ?? null;
    if (calId) this.pruefeOrtsreservierung(eingabe.location_type, eingabe.end_time);
    return inTransaction(this.pool, async (db) => {
      const gruppenname = await this.pruefeGruppe(db, orgId, eingabe.working_group_id);
      const werte: Record<string, unknown> = {
        allowed_roles: ['public', 'member', 'committee', 'admin'],
        ...Object.fromEntries(FELDER.filter((k) => eingabe[k] !== undefined && eingabe[k] !== null && eingabe[k] !== '').map((k) => [k, eingabe[k]])),
        ag_name: gruppenname,
      };
      // Ist das Ortsfeld leer, steht dort Name und Adresse des Plans
      if (calId && !eingabe.location?.trim()) werte.location = await this.buchungen.ortsangabe(db, orgId, calId, aufrufer);
      if (!eingabe.is_recurring) delete werte.recurrence_interval;
      const spalten = Object.keys(werte);
      const eltern = await db.query<{ id: string }>(
        `INSERT INTO events (organization_id, ${spalten.join(', ')}) VALUES ($1, ${spalten.map((_, i) => `$${i + 2}`).join(', ')}) RETURNING id`,
        [orgId, ...spalten.map((s) => werte[s])]
      );
      const id = eltern.rows[0].id;
      const termine: TerminZeit[] = [{ id, title: String(werte.title), date: String(werte.date), start_time: String(werte.start_time), end_time: eingabe.end_time }];
      if (eingabe.is_recurring && eingabe.recurrence_interval && eingabe.date) {
        for (const datum of serienTermine(eingabe.date, eingabe.recurrence_interval)) {
          const kind = await db.query<{ id: string }>(
            `INSERT INTO events (organization_id, title, date, start_time, end_time, location, description, ag_name, working_group_id,
               allowed_roles, max_participants, registration_required, meeting_reason, location_type, is_recurring, recurrence_interval, recurrence_parent_id)
             SELECT organization_id, title, $2, start_time, end_time, location, description, ag_name, working_group_id,
               allowed_roles, max_participants, registration_required, meeting_reason, location_type, true, recurrence_interval, id
               FROM events WHERE id = $1 RETURNING id`,
            [id, datum]
          );
          termine.push({ ...termine[0], id: kind.rows[0].id, date: datum });
        }
      }
      if (calId) await this.buchungen.reserviere(db, { userId, orgId, aufrufer }, calId, termine);
      const angelegt = await this.lade(db, orgId, id);
      await schreibeAudit(db, { table: 'events', operation: 'INSERT', recordId: id, newData: angelegt, performedBy: userId, organizationId: orgId });
      await meldeAenderung(db, { table: 'events', organizationId: orgId, operation: 'INSERT', id });
      // Eine Benachrichtigung je Anlegen (nicht je Folgetermin der Serie; der Bestand benachrichtigte jede Zeile)
      await reihePushEin(db, { organizationId: orgId, kind: 'event', refId: id, title: String(angelegt.title), message: `Neuer Termin: ${angelegt.title}`, url: '/dashboard/calendar' });
      return angelegt;
    });
  }

  async aendern(userId: string, orgId: string, aufrufer: Membership, eventId: string, eingabe: EventEingabe): Promise<Record<string, unknown>> {
    const felder = FELDER.filter((k) => eingabe[k] !== undefined);
    return inTransaction(this.pool, async (db) => {
      const alt = await db.query<{ working_group_id: string | null; title: string; date: string; start_time: string; end_time: string | null; location: string; location_type: string | null }>(
        'SELECT working_group_id, title, date, start_time, end_time, location, location_type FROM events WHERE id = $1 AND organization_id = $2 FOR UPDATE',
        [eventId, orgId]
      );
      if (!alt.rows[0]) throw nichtGefunden('Termin');
      // Berechtigung für die bisherige UND (bei Wechsel) die neue Arbeitsgruppe
      if (!(await this.darfVerwalten(db, aufrufer, alt.rows[0].working_group_id))) throw verboten();
      const neueGruppe = eingabe.working_group_id !== undefined ? eingabe.working_group_id : alt.rows[0].working_group_id;
      if (neueGruppe !== alt.rows[0].working_group_id && !(await this.darfVerwalten(db, aufrufer, neueGruppe))) throw verboten();
      const vorher = await this.lade(db, orgId, eventId);
      if (felder.length === 0 && eingabe.booking_calendar_id === undefined) return vorher;

      if (felder.length > 0) {
        const werte: Record<string, unknown> = Object.fromEntries(felder.map((k) => [k, eingabe[k]]));
        if (eingabe.working_group_id !== undefined) {
          werte.ag_name = await this.pruefeGruppe(db, orgId, eingabe.working_group_id);
        }
        if (eingabe.is_recurring === false) werte.recurrence_interval = null;
        const spalten = Object.keys(werte);
        await db.query(
          `UPDATE events SET ${spalten.map((s, i) => `${s} = $${i + 3}`).join(', ')}, updated_at = now() WHERE id = $1 AND organization_id = $2`,
          [eventId, orgId, ...spalten.map((s) => werte[s])]
        );
      }
      await this.gleicheOrtsreservierungAb(db, { userId, orgId, aufrufer }, eventId, alt.rows[0], eingabe);

      const neu = await this.lade(db, orgId, eventId);
      await schreibeAudit(db, { table: 'events', operation: 'UPDATE', recordId: eventId, oldData: vorher, newData: neu, performedBy: userId, organizationId: orgId });
      await meldeAenderung(db, { table: 'events', organizationId: orgId, operation: 'UPDATE', id: eventId });
      return neu;
    });
  }

  /**
   * Hält die Buchung mit dem Termin synchron (selbe Transaktion): Ort entfernt oder gewechselt → alte Buchung storniert, ggf.
   * neue angelegt; Datum oder Uhrzeit geändert → die Buchung zieht mit (braucht eine Rolle im Plan); kein „Vor Ort“ mehr → Buchung entfällt.
   */
  private async gleicheOrtsreservierungAb(
    db: Db,
    k: { userId: string; orgId: string; aufrufer: Membership },
    eventId: string,
    alt: { title: string; date: string; start_time: string; end_time: string | null; location: string; location_type: string | null },
    eingabe: EventEingabe
  ): Promise<void> {
    const zeit = (x: string | null | undefined) => (x ?? '').slice(0, 5);
    const neu: TerminZeit = {
      id: eventId,
      title: eingabe.title ?? alt.title,
      date: eingabe.date ?? alt.date,
      start_time: eingabe.start_time ?? alt.start_time,
      end_time: eingabe.end_time !== undefined ? eingabe.end_time : alt.end_time,
    };
    const zeitGeaendert = neu.date !== alt.date || zeit(neu.start_time) !== zeit(alt.start_time) || zeit(neu.end_time) !== zeit(alt.end_time);
    const ortsart = eingabe.location_type !== undefined ? eingabe.location_type : alt.location_type;
    const aktive = await this.buchungen.aktive(db, k.orgId, eventId, true);
    const neuerPlan = eingabe.booking_calendar_id;

    if (neuerPlan !== undefined) {
      const wechsel = !aktive || neuerPlan !== aktive.calendar_id;
      if (aktive && (neuerPlan === null || wechsel)) await this.buchungen.entferne(db, k, eventId);
      if (neuerPlan !== null && wechsel) {
        this.pruefeOrtsreservierung(ortsart, neu.end_time);
        await this.buchungen.reserviere(db, k, neuerPlan, [neu]);
        const ort = eingabe.location !== undefined ? eingabe.location : alt.location;
        if (!ort?.trim()) await db.query('UPDATE events SET location = $3 WHERE id = $1 AND organization_id = $2', [eventId, k.orgId, await this.buchungen.ortsangabe(db, k.orgId, neuerPlan, k.aufrufer)]);
        return;
      }
      if (neuerPlan === null) return;
    }
    if (!aktive) return;
    if (ortsart !== 'onsite') {
      await this.buchungen.entferne(db, k, eventId);
      return;
    }
    if (zeitGeaendert) await this.buchungen.verschiebe(db, k, neu);
  }

  async loeschen(userId: string, orgId: string, aufrufer: Membership, eventId: string): Promise<void> {
    await inTransaction(this.pool, async (db) => {
      const alt = await db.query<{ working_group_id: string | null }>('SELECT working_group_id FROM events WHERE id = $1 AND organization_id = $2 FOR UPDATE', [eventId, orgId]);
      if (!alt.rows[0]) throw nichtGefunden('Termin');
      if (!(await this.darfVerwalten(db, aufrufer, alt.rows[0].working_group_id))) throw verboten();
      const vorher = await this.lade(db, orgId, eventId);
      await db.query('DELETE FROM events WHERE id = $1', [eventId]);
      await schreibeAudit(db, { table: 'events', operation: 'DELETE', recordId: eventId, oldData: vorher, performedBy: userId, organizationId: orgId });
      await meldeAenderung(db, { table: 'events', organizationId: orgId, operation: 'DELETE', id: eventId });
    });
  }

  // ── Anmeldungen ─────────────────────────────────────────────────────────────

  async meineAnmeldungen(orgId: string, aufrufer: Membership): Promise<Array<{ event_id: string; status: string }>> {
    const { rows } = await this.pool.query(
      `SELECT r.event_id, r.status FROM event_registrations r JOIN events e ON e.id = r.event_id
        WHERE r.member_id = $1 AND e.organization_id = $2`,
      [aufrufer.member.id, orgId]
    );
    return rows;
  }

  async teilnehmer(orgId: string, aufrufer: Membership, eventId: string): Promise<Array<{ member: { id: string; name: string; avatar_url: string | null } }>> {
    await this.lade(this.pool, orgId, eventId, aufrufer);
    const { rows } = await this.pool.query(
      `SELECT jsonb_build_object('id', m.id, 'name', m.name, 'avatar_url', m.avatar_url) AS member
         FROM event_registrations r JOIN members m ON m.id = r.member_id
        WHERE r.event_id = $1 AND r.status IN ('confirmed', 'maybe') ORDER BY r.registered_at ASC`,
      [eventId]
    );
    return rows;
  }

  /** Zusagen je Termin: Anzahl und die ersten fünf Teilnehmer (nur für sichtbare Termine der Organisation). */
  async zusammenfassung(orgId: string, aufrufer: Membership, eventIds: string[]): Promise<Record<string, { count: number; avatars: Array<{ name: string; avatar_url: string | null }> }>> {
    const ergebnis: Record<string, { count: number; avatars: Array<{ name: string; avatar_url: string | null }> }> = {};
    const { rows: sichtbar } = await this.pool.query<{ id: string }>(
      `SELECT e.id FROM events e WHERE e.organization_id = $1 AND e.id = ANY($4::uuid[]) AND ${sichtbarkeitsBedingung(2)}`,
      [orgId, sichtbarkeitsRang(aufrufer), await this.agIds(this.pool, aufrufer.member.id), eventIds]
    );
    for (const { id } of sichtbar) ergebnis[id] = { count: 0, avatars: [] };
    const { rows } = await this.pool.query<{ event_id: string; name: string; avatar_url: string | null }>(
      `SELECT r.event_id, m.name, m.avatar_url FROM event_registrations r JOIN members m ON m.id = r.member_id
        WHERE r.event_id = ANY($1::uuid[]) AND r.status = 'confirmed' ORDER BY r.registered_at ASC`,
      [sichtbar.map((s) => s.id)]
    );
    for (const r of rows) {
      const eintrag = ergebnis[r.event_id];
      eintrag.count += 1;
      if (eintrag.avatars.length < 5) eintrag.avatars.push({ name: r.name, avatar_url: r.avatar_url });
    }
    return ergebnis;
  }

  /** Anmeldung/Zusage/Absage; bei begrenzter Teilnehmerzahl wird unter Sperre des Termins gezählt (keine Überbuchung). */
  async anmelden(orgId: string, aufrufer: Membership, eventId: string, status: string, note?: string | null): Promise<{ event_id: string; status: string }> {
    return inTransaction(this.pool, async (db) => {
      await this.lade(db, orgId, eventId, aufrufer);
      const termin = await db.query<{ max_participants: number | null }>('SELECT max_participants FROM events WHERE id = $1 FOR UPDATE', [eventId]);
      const bisher = await db.query<{ status: string }>('SELECT status FROM event_registrations WHERE event_id = $1 AND member_id = $2', [eventId, aufrufer.member.id]);
      const max = termin.rows[0].max_participants;
      if (status === 'confirmed' && max !== null && bisher.rows[0]?.status !== 'confirmed') {
        const { rows } = await db.query<{ n: string }>("SELECT count(*) AS n FROM event_registrations WHERE event_id = $1 AND status = 'confirmed'", [eventId]);
        if (Number(rows[0].n) >= max) throw konflikt('event_full', 'Der Termin ist ausgebucht');
      }
      await db.query(
        `INSERT INTO event_registrations (event_id, member_id, status, note, registered_at) VALUES ($1, $2, $3, $4, now())
         ON CONFLICT (event_id, member_id) DO UPDATE SET status = EXCLUDED.status, note = EXCLUDED.note, registered_at = now()`,
        [eventId, aufrufer.member.id, status, note ?? null]
      );
      await meldeAenderung(db, { table: 'event_registrations', organizationId: orgId, operation: 'UPDATE', id: eventId });
      return { event_id: eventId, status };
    });
  }

  async abmelden(orgId: string, aufrufer: Membership, eventId: string): Promise<void> {
    await inTransaction(this.pool, async (db) => {
      await this.lade(db, orgId, eventId, aufrufer);
      await db.query('DELETE FROM event_registrations WHERE event_id = $1 AND member_id = $2', [eventId, aufrufer.member.id]);
      await meldeAenderung(db, { table: 'event_registrations', organizationId: orgId, operation: 'DELETE', id: eventId });
    });
  }
}
