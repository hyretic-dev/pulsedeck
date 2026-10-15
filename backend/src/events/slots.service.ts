import { Inject, Injectable } from '@nestjs/common';
import type { Pool } from 'pg';

import { inTransaction } from '../common/db';
import { konflikt, nichtGefunden, ungueltig, verboten } from '../common/http-error';
import { PG_POOL } from '../infrastructure/postgres/pg.pool';
import type { Membership } from '../tenancy/membership';

import { EventsService } from './events.service';
import { sichtbarkeitsBedingung, sichtbarkeitsRang } from './visibility';

const SLOT_SPALTEN = 's.id, s.event_id, s.organization_id, s.title, s.start_time, s.end_time, s.max_helpers, COALESCE(s.required_skills, \'{}\') AS required_skills, s.sort_order, s.created_at, s.updated_at';

export interface SlotEingabe {
  title?: string;
  start_time?: string | null;
  end_time?: string | null;
  max_helpers?: number;
  required_skills?: string[];
  sort_order?: number;
}
const FELDER = ['title', 'start_time', 'end_time', 'max_helpers', 'required_skills', 'sort_order'] as const;

@Injectable()
export class SlotsService {
  constructor(
    @Inject(PG_POOL) private readonly pool: Pool,
    private readonly events: EventsService
  ) {}

  /** Slots eines (für den Aufrufer sichtbaren) Termins mit bestätigten Anmeldungen. */
  async liste(orgId: string, aufrufer: Membership, eventId: string): Promise<Record<string, unknown>[]> {
    await this.events.einzeln(orgId, aufrufer, eventId);
    const { rows } = await this.pool.query(
      `SELECT ${SLOT_SPALTEN},
              COALESCE(jsonb_agg(jsonb_build_object('id', su.id, 'member_id', su.member_id, 'status', su.status, 'note', su.note,
                         'signed_up_at', su.signed_up_at, 'member', jsonb_build_object('id', m.id, 'name', m.name, 'avatar_url', m.avatar_url))
                         ORDER BY su.signed_up_at) FILTER (WHERE su.id IS NOT NULL), '[]') AS signups
         FROM event_slots s
         LEFT JOIN event_slot_signups su ON su.slot_id = s.id AND su.status = 'confirmed'
         LEFT JOIN members m ON m.id = su.member_id
        WHERE s.event_id = $1 AND s.organization_id = $2
        GROUP BY s.id ORDER BY s.sort_order ASC, s.created_at ASC`,
      [eventId, orgId]
    );
    return rows.map((slot) => ({
      ...slot,
      signup_count: slot.signups.length,
      is_signed_up: slot.signups.some((x: { member_id: string }) => x.member_id === aufrufer.member.id),
    }));
  }

  private async ladeSlot(orgId: string, slotId: string): Promise<{ id: string; event_id: string; max_helpers: number; working_group_id: string | null }> {
    const { rows } = await this.pool.query(
      `SELECT s.id, s.event_id, s.max_helpers, e.working_group_id FROM event_slots s JOIN events e ON e.id = s.event_id
        WHERE s.id = $1 AND s.organization_id = $2`,
      [slotId, orgId]
    );
    if (!rows[0]) throw nichtGefunden('Helferslot');
    return rows[0];
  }

  async anlegen(orgId: string, aufrufer: Membership, eventId: string, eingabe: SlotEingabe & { title: string }): Promise<Record<string, unknown>> {
    const termin = await this.pool.query<{ working_group_id: string | null }>('SELECT working_group_id FROM events WHERE id = $1 AND organization_id = $2', [eventId, orgId]);
    if (!termin.rows[0]) throw nichtGefunden('Termin');
    if (!(await this.events.darfVerwalten(this.pool, aufrufer, termin.rows[0].working_group_id))) throw verboten();
    await this.pruefeSkills(orgId, eingabe.required_skills);
    const felder = FELDER.filter((k) => eingabe[k] !== undefined);
    const { rows } = await this.pool.query(
      `INSERT INTO event_slots (organization_id, event_id, ${felder.join(', ')}) VALUES ($1, $2, ${felder.map((_, i) => `$${i + 3}`).join(', ')}) RETURNING id`,
      [orgId, eventId, ...felder.map((k) => eingabe[k])]
    );
    const geladen = await this.pool.query(`SELECT ${SLOT_SPALTEN} FROM event_slots s WHERE s.id = $1`, [rows[0].id]);
    return geladen.rows[0];
  }

  private async pruefeSkills(orgId: string, skillIds?: string[]): Promise<void> {
    if (!skillIds || skillIds.length === 0) return;
    const { rows } = await this.pool.query('SELECT count(*)::int AS n FROM skills WHERE organization_id = $1 AND id = ANY($2::uuid[])', [orgId, skillIds]);
    if (rows[0].n !== new Set(skillIds).size) throw ungueltig('Mindestens eine Fähigkeit gehört nicht zu dieser Organisation');
  }

  async aendern(orgId: string, aufrufer: Membership, slotId: string, eingabe: SlotEingabe): Promise<Record<string, unknown>> {
    const slot = await this.ladeSlot(orgId, slotId);
    if (!(await this.events.darfVerwalten(this.pool, aufrufer, slot.working_group_id))) throw verboten();
    await this.pruefeSkills(orgId, eingabe.required_skills);
    const felder = FELDER.filter((k) => eingabe[k] !== undefined);
    return inTransaction(this.pool, async (db) => {
      await db.query('SELECT 1 FROM event_slots WHERE id = $1 FOR UPDATE', [slotId]);
      if (eingabe.max_helpers !== undefined) {
        const { rows } = await db.query<{ n: string }>("SELECT count(*) AS n FROM event_slot_signups WHERE slot_id = $1 AND status = 'confirmed'", [slotId]);
        if (eingabe.max_helpers < Number(rows[0].n)) throw konflikt('slot_over_capacity', 'Es sind bereits mehr Helfer angemeldet als das neue Limit');
      }
      if (felder.length > 0) {
        await db.query(
          `UPDATE event_slots SET ${felder.map((k, i) => `${k} = $${i + 3}`).join(', ')}, updated_at = now() WHERE id = $1 AND organization_id = $2`,
          [slotId, orgId, ...felder.map((k) => eingabe[k])]
        );
      }
      const { rows } = await db.query(`SELECT ${SLOT_SPALTEN} FROM event_slots s WHERE s.id = $1`, [slotId]);
      return rows[0];
    });
  }

  async loeschen(orgId: string, aufrufer: Membership, slotId: string): Promise<void> {
    const slot = await this.ladeSlot(orgId, slotId);
    if (!(await this.events.darfVerwalten(this.pool, aufrufer, slot.working_group_id))) throw verboten();
    await this.pool.query('DELETE FROM event_slots WHERE id = $1 AND organization_id = $2', [slotId, orgId]);
  }

  /** Anmeldung zu einem Slot; zählt unter Sperre des Slots (parallele Anmeldungen überbuchen nie). */
  async anmelden(orgId: string, aufrufer: Membership, slotId: string, note?: string | null): Promise<{ slot_id: string; status: string }> {
    const slot = await this.ladeSlot(orgId, slotId);
    await this.events.einzeln(orgId, aufrufer, slot.event_id); // Termin muss für den Aufrufer sichtbar sein
    return inTransaction(this.pool, async (db) => {
      const gesperrt = await db.query<{ max_helpers: number }>('SELECT max_helpers FROM event_slots WHERE id = $1 FOR UPDATE', [slotId]);
      const vorhanden = await db.query<{ status: string }>('SELECT status FROM event_slot_signups WHERE slot_id = $1 AND member_id = $2', [slotId, aufrufer.member.id]);
      if (vorhanden.rows[0]?.status !== 'confirmed') {
        const { rows } = await db.query<{ n: string }>("SELECT count(*) AS n FROM event_slot_signups WHERE slot_id = $1 AND status = 'confirmed'", [slotId]);
        if (Number(rows[0].n) >= gesperrt.rows[0].max_helpers) throw konflikt('slot_full', 'Dieser Helferslot ist bereits voll');
      }
      await db.query(
        `INSERT INTO event_slot_signups (organization_id, slot_id, member_id, status, note) VALUES ($1, $2, $3, 'confirmed', $4)
         ON CONFLICT (slot_id, member_id) DO UPDATE SET status = 'confirmed', note = EXCLUDED.note, signed_up_at = now()`,
        [orgId, slotId, aufrufer.member.id, note ?? null]
      );
      return { slot_id: slotId, status: 'confirmed' };
    });
  }

  async abmelden(orgId: string, aufrufer: Membership, slotId: string): Promise<void> {
    await this.ladeSlot(orgId, slotId);
    await this.pool.query('DELETE FROM event_slot_signups WHERE slot_id = $1 AND member_id = $2', [slotId, aufrufer.member.id]);
  }

  /** Eigene bestätigte Helfer-Anmeldungen mit Slot und Termin (im Bestand scheiterte die Abfrage an einer falschen Spalte). */
  async meineAnmeldungen(orgId: string, aufrufer: Membership): Promise<Record<string, unknown>[]> {
    const { rows } = await this.pool.query(
      `SELECT jsonb_build_object('id', s.id, 'title', s.title, 'start_time', s.start_time, 'end_time', s.end_time,
                'event', jsonb_build_object('id', e.id, 'title', e.title, 'date', e.date, 'start_time', e.start_time)) AS slot
         FROM event_slot_signups su JOIN event_slots s ON s.id = su.slot_id JOIN events e ON e.id = s.event_id
        WHERE su.member_id = $1 AND su.status = 'confirmed' AND s.organization_id = $2
        ORDER BY su.signed_up_at DESC`,
      [aufrufer.member.id, orgId]
    );
    return rows;
  }

  /**
   * Passende Einsatzmöglichkeiten für das eigene Mitglied (Ersatz für den N+1-Abgleich im Browser):
   * kommende, sichtbare Termine mit freien Plätzen, ohne bereits bestätigte Anmeldung, Treffer nach
   * Fähigkeiten zuerst, dann nach Datum; höchstens drei.
   */
  async chancen(orgId: string, aufrufer: Membership): Promise<{ opportunities: Record<string, unknown>[]; has_skills: boolean }> {
    const meineSkills = await this.pool.query<{ skill_id: string }>('SELECT skill_id FROM member_skills WHERE member_id = $1', [aufrufer.member.id]);
    const skillIds = meineSkills.rows.map((r) => r.skill_id);
    const heute = new Date().toISOString().split('T')[0];
    const { rows } = await this.pool.query(
      `SELECT s.id AS slot_id, s.title AS slot_title, e.id AS event_id, e.title AS event_title, e.date AS event_date,
              e.location AS event_location, COALESCE(s.required_skills, '{}') AS required_skills,
              s.max_helpers - (SELECT count(*) FROM event_slot_signups su WHERE su.slot_id = s.id AND su.status = 'confirmed')::int AS remaining_spots,
              EXISTS (SELECT 1 FROM event_slot_signups su WHERE su.slot_id = s.id AND su.member_id = $5 AND su.status = 'confirmed') AS bereits_angemeldet,
              COALESCE((SELECT array_agg(k.name ORDER BY k.name) FROM skills k WHERE k.id::text = ANY(s.required_skills) AND k.id = ANY($6::uuid[])), '{}') AS matching_skills
         FROM event_slots s JOIN events e ON e.id = s.event_id
        WHERE s.organization_id = $1 AND e.date >= $4 AND ${sichtbarkeitsBedingung(2)}`,
      [orgId, sichtbarkeitsRang(aufrufer), await this.events.agIds(this.pool, aufrufer.member.id), heute, aufrufer.member.id, skillIds]
    );
    const passend = rows
      .filter((r) => r.remaining_spots > 0 && !r.bereits_angemeldet)
      .map(({ required_skills: _a, bereits_angemeldet: _b, ...rest }) => ({ ...rest, has_skill_match: rest.matching_skills.length > 0 }))
      .sort((a, b) => (a.has_skill_match === b.has_skill_match ? a.event_date.localeCompare(b.event_date) : a.has_skill_match ? -1 : 1));
    return { opportunities: passend.slice(0, 3), has_skills: skillIds.length > 0 };
  }
}
