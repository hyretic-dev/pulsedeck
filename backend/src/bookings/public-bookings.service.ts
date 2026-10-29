import { Inject, Injectable } from '@nestjs/common';
import type { Pool } from 'pg';

import { nichtGefunden, ungueltig } from '../common/http-error';
import { PG_POOL } from '../infrastructure/postgres/pg.pool';

/** Längster abrufbarer Zeitraum der öffentlichen Ansicht (ein Jahr samt Rand). */
const MAX_TAGE = 400;

export interface OeffentlicherPlan {
  id: string;
  name: string;
  kind: 'place' | 'item';
  address: string | null;
  state: string | null;
  window_start: number;
  window_end: number;
  public_view: 'week' | 'month' | 'year';
}

export interface OeffentlicheBuchung {
  id: string;
  title: string;
  start_at: Date;
  end_at: Date;
  /** Nur gesetzt, wenn die Buchung zu einem öffentlichen Termin gehört (Link auf /event/:id). */
  event_id: string | null;
}

/**
 * Öffentliche Ansicht der Belegung (anonym, nur lesen): nur Pläne mit öffentlicher Anzeige und nur angenommene, öffentliche
 * Buchungen mit Titel und Zeitraum. Nie Namen, Notizen, offene oder interne Buchungen. Unbekannte Organisationen und nicht
 * öffentliche Pläne sind nicht unterscheidbar (404).
 */
@Injectable()
export class PublicBookingsService {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  async plaene(slug: string): Promise<OeffentlicherPlan[]> {
    const { rows } = await this.pool.query<OeffentlicherPlan>(
      `SELECT c.id, c.name, c.kind, c.address, c.state, c.window_start, c.window_end, c.public_view
         FROM booking_calendars c JOIN organizations o ON o.id = c.organization_id
        WHERE o.slug = $1 AND c.public_view <> 'none'
        ORDER BY c.sort_order, c.name`,
      [slug]
    );
    return rows;
  }

  async buchungen(slug: string, calId: string, von: string, bis: string): Promise<OeffentlicheBuchung[]> {
    const { rows: ok } = await this.pool.query<{ id: string; organization_id: string }>(
      `SELECT c.id, c.organization_id FROM booking_calendars c JOIN organizations o ON o.id = c.organization_id
        WHERE o.slug = $1 AND c.id = $2 AND c.public_view <> 'none'`,
      [slug, calId]
    );
    if (!ok[0]) throw nichtGefunden('Belegungsplan');
    const tage = (Date.parse(bis) - Date.parse(von)) / 86_400_000;
    if (Number.isNaN(tage) || tage < 0) throw ungueltig('„bis“ liegt vor „von“');
    if (tage > MAX_TAGE) throw ungueltig('Der Zeitraum ist zu lang');
    const { rows } = await this.pool.query<OeffentlicheBuchung>(
      `SELECT b.id, COALESCE(e.title, b.title) AS title, b.starts_at AS start_at, b.ends_at AS end_at,
              CASE WHEN e.id IS NOT NULL THEN e.id ELSE NULL END AS event_id
         FROM bookings b
         LEFT JOIN events e ON e.id = b.event_id AND e.organization_id = b.organization_id
        WHERE b.calendar_id = $1 AND b.organization_id = $2 AND b.status = 'approved'
          AND (CASE WHEN b.event_id IS NOT NULL THEN COALESCE('public' = ANY(e.allowed_roles), false) ELSE b.is_public END)
          AND b.starts_at < (($4::date + 1)::timestamp AT TIME ZONE 'Europe/Berlin')
          AND b.ends_at > ($3::date::timestamp AT TIME ZONE 'Europe/Berlin')
        ORDER BY b.starts_at`,
      [calId, ok[0].organization_id, von, bis]
    );
    return rows;
  }
}
