import { Inject, Injectable } from '@nestjs/common';
import type { Pool } from 'pg';

import { sichtbarkeitsBedingung, sichtbarkeitsRang } from '../events/visibility';
import { dateiSichtbarkeitsAusdruck } from '../files/file-visibility';
import { PG_POOL } from '../infrastructure/postgres/pg.pool';
import type { Membership } from '../tenancy/membership';

export interface DashboardStats {
  totalMembers: number;
  totalWorkingGroups: number;
  totalEvents: number;
  upcomingEvents: number;
  totalWikiArticles: number;
  totalFiles: number;
  totalFeedItems: number;
  activeMembers: number;
  newMembersThisMonth: number;
  eventsThisMonth: number;
}

export interface Geburtstag {
  id: string;
  name: string;
  avatar_url: string | null;
  /** Nur Tag und Monat („TT.MM.“); das Geburtsjahr verlässt den Server nicht. */
  birthday: string;
  days_until: number;
}

/** Tage bis zum nächsten Geburtstag aus „TT.MM.[JJ[JJ]]“ (null bei unlesbarem Wert). */
export function tageBisGeburtstag(wert: string | null, heute: Date): { tage: number; text: string } | null {
  const teile = (wert ?? '').trim().split('.');
  if (teile.length < 2) return null;
  const tag = parseInt(teile[0], 10);
  const monat = parseInt(teile[1], 10);
  if (!Number.isInteger(tag) || !Number.isInteger(monat) || monat < 1 || monat > 12 || tag < 1 || tag > 31) return null;
  const start = Date.UTC(heute.getUTCFullYear(), heute.getUTCMonth(), heute.getUTCDate());
  let ziel = Date.UTC(heute.getUTCFullYear(), monat - 1, tag);
  if (ziel < start) ziel = Date.UTC(heute.getUTCFullYear() + 1, monat - 1, tag);
  return { tage: Math.round((ziel - start) / 86_400_000), text: `${String(tag).padStart(2, '0')}.${String(monat).padStart(2, '0')}.` };
}

@Injectable()
export class DashboardService {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  /**
   * Kennzahlen der Startseite. Termine und Dateien zählen nur, was der Aufrufer sehen darf; Beiträge nur veröffentlichte.
   * Alles in einer Abfrage statt zehn Zählungen im Browser.
   */
  async statistik(orgId: string, aufrufer: Membership): Promise<DashboardStats> {
    const heute = new Date().toISOString().split('T')[0];
    const monatsanfang = `${heute.slice(0, 8)}01`;
    const naechster = new Date(Date.UTC(Number(heute.slice(0, 4)), Number(heute.slice(5, 7)), 1)).toISOString().split('T')[0];
    const { rows: gruppen } = await this.pool.query<{ working_group_id: string }>(
      'SELECT working_group_id FROM ag_memberships WHERE member_id = $1 UNION SELECT working_group_id FROM working_group_members WHERE member_id = $1',
      [aufrufer.member.id]
    );
    const rang = sichtbarkeitsRang(aufrufer);
    const ags = gruppen.map((g) => g.working_group_id);
    const { rows } = await this.pool.query(
      `SELECT
         (SELECT count(*)::int FROM members WHERE organization_id = $1) AS "totalMembers",
         (SELECT count(*)::int FROM working_groups WHERE organization_id = $1) AS "totalWorkingGroups",
         (SELECT count(*)::int FROM events e WHERE e.organization_id = $1 AND ${sichtbarkeitsBedingung(3)}) AS "totalEvents",
         (SELECT count(*)::int FROM events e WHERE e.organization_id = $1 AND e.date >= $2::text AND ${sichtbarkeitsBedingung(3)}) AS "upcomingEvents",
         (SELECT count(*)::int FROM wiki_docs WHERE organization_id = $1 AND status = 'Published') AS "totalWikiArticles",
         (SELECT count(*)::int FROM files f WHERE f.organization_id = $1 AND ${dateiSichtbarkeitsAusdruck('$5::uuid', '$3::int', '$4::uuid[]')}) AS "totalFiles",
         (SELECT count(*)::int FROM feed_items WHERE organization_id = $1 AND status IN ('approved', 'sent')) AS "totalFeedItems",
         (SELECT count(*)::int FROM members WHERE organization_id = $1 AND user_id IS NOT NULL) AS "activeMembers",
         (SELECT count(*)::int FROM members WHERE organization_id = $1 AND created_at >= $6::text::date) AS "newMembersThisMonth",
         (SELECT count(*)::int FROM events e WHERE e.organization_id = $1 AND e.date >= $6::text AND e.date < $7::text AND ${sichtbarkeitsBedingung(3)}) AS "eventsThisMonth"`,
      [orgId, heute, rang, ags, aufrufer.member.id, monatsanfang, naechster]
    );
    return rows[0];
  }

  /** Geburtstage der nächsten sieben Tage aktiver Mitglieder (ohne Geburtsjahr), höchstens fünf. */
  async geburtstage(orgId: string): Promise<Geburtstag[]> {
    const { rows } = await this.pool.query<{ id: string; name: string; avatar_url: string | null; birthday: string }>(
      "SELECT id, name, avatar_url, birthday FROM members WHERE organization_id = $1 AND status = 'Active' AND birthday IS NOT NULL AND birthday <> ''",
      [orgId]
    );
    const heute = new Date();
    return rows
      .flatMap((m) => {
        const info = tageBisGeburtstag(m.birthday, heute);
        return info && info.tage <= 7 ? [{ id: m.id, name: m.name, avatar_url: m.avatar_url, birthday: info.text, days_until: info.tage }] : [];
      })
      .sort((a, b) => a.days_until - b.days_until || a.name.localeCompare(b.name))
      .slice(0, 5);
  }
}
