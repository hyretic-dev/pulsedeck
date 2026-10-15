import { randomBytes } from 'node:crypto';

import { Inject, Injectable } from '@nestjs/common';
import type { Pool } from 'pg';

import { apiFehler, nichtGefunden } from '../common/http-error';
import { schreibeAudit } from '../common/audit';
import { APP_CONFIG, type AppConfig } from '../config/configuration';
import { EVENT_SPALTEN } from '../events/events.service';
import { sichtbarkeitsBedingung } from '../events/visibility';
import { PG_POOL } from '../infrastructure/postgres/pg.pool';
import type { Membership } from '../tenancy/membership';

import { erzeugeIcal } from './ical';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

@Injectable()
export class CalendarService {
  constructor(
    @Inject(PG_POOL) private readonly pool: Pool,
    @Inject(APP_CONFIG) private readonly config: AppConfig
  ) {}

  /**
   * iCal-Abonnement. Mit Token (`members.calendar_token`) sieht der Abonnent genau die Termine, die das Mitglied in der App sieht;
   * ohne Token nur öffentliche Termine einer Organisation (ID oder Kürzel). Ein ungültiger Token liefert 401 und nie öffentliche Daten.
   */
  async abo(optionen: { token?: string; org?: string; ag?: string }): Promise<{ name: string; ics: string; privat: boolean }> {
    let orgId: string;
    let rang = 0;
    let gruppen: string[] = [];
    let privat = false;
    if (optionen.token) {
      const { rows } = await this.pool.query<{ id: string; organization_id: string; rang: number }>(
        `SELECT m.id, m.organization_id,
                CASE WHEN o.owner_id = m.user_id OR COALESCE(r.is_system_admin, false) OR m.app_role = 'admin' THEN 3 WHEN m.app_role = 'committee' THEN 2 ELSE 1 END AS rang
           FROM members m JOIN organizations o ON o.id = m.organization_id LEFT JOIN organization_roles r ON r.id = m.role_id
          WHERE m.calendar_token = $1`,
        [optionen.token]
      );
      if (!rows[0]) throw apiFehler(401, 'invalid_calendar_token', 'Ungültiger Kalender-Token');
      orgId = rows[0].organization_id;
      rang = rows[0].rang;
      privat = true;
      const ag = await this.pool.query<{ working_group_id: string }>(
        'SELECT working_group_id FROM ag_memberships WHERE member_id = $1 UNION SELECT working_group_id FROM working_group_members WHERE member_id = $1',
        [rows[0].id]
      );
      gruppen = ag.rows.map((g) => g.working_group_id);
    } else {
      if (!optionen.org) throw apiFehler(400, 'validation_failed', 'Organisation oder Token ist erforderlich');
      const { rows } = await this.pool.query<{ id: string }>(`SELECT id FROM organizations WHERE ${UUID.test(optionen.org) ? 'id = $1::uuid' : 'slug = $1'}`, [optionen.org]);
      if (!rows[0]) throw nichtGefunden('Organisation');
      orgId = rows[0].id;
    }

    const grenze = new Date(Date.now() - 30 * 86_400_000).toISOString().split('T')[0];
    const params: unknown[] = [orgId, grenze];
    const bedingungen = ['e.organization_id = $1', 'e.date >= $2'];
    if (optionen.ag) {
      if (!UUID.test(optionen.ag)) throw apiFehler(400, 'validation_failed', 'Ungültige Arbeitsgruppen-ID');
      bedingungen.push(`e.working_group_id = $${params.push(optionen.ag)}`);
    }
    if (privat) {
      const rangPosition = params.push(rang); // $rang, direkt danach $arbeitsgruppen
      params.push(gruppen);
      bedingungen.push(sichtbarkeitsBedingung(rangPosition));
    } else {
      bedingungen.push("'public' = ANY(e.allowed_roles)");
    }
    const { rows: termine } = await this.pool.query(
      `SELECT ${EVENT_SPALTEN} FROM events e LEFT JOIN working_groups g ON g.id = e.working_group_id WHERE ${bedingungen.join(' AND ')} ORDER BY e.date ASC, e.start_time ASC`,
      params
    );
    let name = 'PulseDeck Kalender';
    if (optionen.ag) {
      const ag = await this.pool.query<{ name: string }>('SELECT name FROM working_groups WHERE id = $1 AND organization_id = $2', [optionen.ag, orgId]);
      if (ag.rows[0]) name = `PulseDeck - ${ag.rows[0].name}`;
    }
    return {
      name,
      privat,
      ics: erzeugeIcal(termine as never, { kalenderName: name, zone: this.config.timeZone, host: new URL(this.config.appBaseUrl).host }),
    };
  }

  /** Neuer Kalender-Token (der alte Abo-Link wird ungültig); sinnvoll, wenn der Link geteilt oder geleakt wurde. */
  async tokenErneuern(userId: string, orgId: string, aufrufer: Membership): Promise<{ calendar_token: string }> {
    const token = randomBytes(16).toString('hex');
    await this.pool.query('UPDATE members SET calendar_token = $2, updated_at = now() WHERE id = $1', [aufrufer.member.id, token]);
    await schreibeAudit(this.pool, { table: 'members', operation: 'UPDATE', recordId: aufrufer.member.id, newData: { changed: ['calendar_token'] }, performedBy: userId, organizationId: orgId });
    return { calendar_token: token };
  }
}
