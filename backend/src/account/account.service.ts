import { Inject, Injectable } from '@nestjs/common';
import type { Pool } from 'pg';

import { PG_POOL } from '../infrastructure/postgres/pg.pool';

type Zeile = Record<string, unknown>;

/**
 * Tabellen, die direkt an einem Mitglied hängen, mit den Spalten, die nicht herausgegeben werden (Geheimnisse). Neue Tabellen
 * mit `member_id` gehören hier hinein, sonst fehlen sie im Export.
 */
export const MITGLIEDS_TABELLEN: Array<{ tabelle: string; ohne?: string[]; name?: { tabelle: string; fk: string } }> = [
  { tabelle: 'member_skills', name: { tabelle: 'skills', fk: 'skill_id' } },
  { tabelle: 'working_group_members', name: { tabelle: 'working_groups', fk: 'working_group_id' } },
  { tabelle: 'ag_memberships', name: { tabelle: 'working_groups', fk: 'working_group_id' } },
  { tabelle: 'event_registrations' },
  { tabelle: 'event_slot_signups' },
  { tabelle: 'booking_calendar_members' },
  { tabelle: 'booking_series' },
  { tabelle: 'bookings' },
  { tabelle: 'poll_votes' },
  { tabelle: 'feed_item_reads' },
  { tabelle: 'onboarding_progress' },
  { tabelle: 'user_tasks' },
  { tabelle: 'push_subscriptions', ohne: ['p256dh', 'auth'] },
];

/** Selbstauskunft über das eigene Konto (Art. 15/20 DSGVO): alles zur Person, nichts über andere, keine Geheimnisse. */
@Injectable()
export class AccountService {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  async export(userId: string): Promise<Zeile> {
    const zeilen = async (sql: string, werte: unknown[]): Promise<Zeile[]> => (await this.pool.query<{ z: Zeile }>(sql, werte)).rows.map((r) => r.z);

    const [account] = await zeilen("SELECT to_jsonb(u) - 'password_hash' AS z FROM auth_users u WHERE id = $1", [userId]);
    const mitglieder = await zeilen(
      `SELECT jsonb_build_object('organization', jsonb_build_object('id', o.id, 'slug', o.slug, 'name', o.name),
                                 'member', to_jsonb(m) - 'connection_token' - 'calendar_token') AS z
         FROM members m JOIN organizations o ON o.id = m.organization_id
        WHERE m.user_id = $1 ORDER BY o.name`,
      [userId]
    );
    const memberships: Zeile[] = [];
    for (const eintrag of mitglieder) {
      const memberId = (eintrag.member as { id: string }).id;
      const mitgliedschaft: Zeile = { ...eintrag };
      for (const { tabelle, ohne = [], name } of MITGLIEDS_TABELLEN) {
        const entfernen = ohne.map((s) => ` - '${s}'`).join('');
        mitgliedschaft[tabelle] = name
          ? await zeilen(`SELECT (to_jsonb(t)${entfernen}) || jsonb_build_object('name', n.name) AS z FROM ${tabelle} t LEFT JOIN ${name.tabelle} n ON n.id = t.${name.fk} WHERE t.member_id = $1`, [memberId])
          : await zeilen(`SELECT to_jsonb(t)${entfernen} AS z FROM ${tabelle} t WHERE t.member_id = $1`, [memberId]);
      }
      mitgliedschaft.authored_feed_items = await zeilen('SELECT jsonb_build_object(\'id\', id, \'title\', title, \'created_at\', created_at) AS z FROM feed_items WHERE author_id = $1 ORDER BY created_at', [memberId]);
      mitgliedschaft.uploaded_files = await zeilen("SELECT to_jsonb(f) - 'storage_path' AS z FROM files f WHERE uploaded_by = $1 ORDER BY created_at", [memberId]);
      memberships.push(mitgliedschaft);
    }
    const chat_sessions = await zeilen(
      `SELECT to_jsonb(s) || jsonb_build_object('messages', COALESCE((
                SELECT jsonb_agg(jsonb_build_object('role', c.role, 'content', c.content, 'created_at', c.created_at) ORDER BY c.created_at)
                  FROM chat_messages c WHERE c.session_id = s.id AND c.role IN ('user', 'assistant')), '[]'::jsonb)) AS z
         FROM chat_sessions s WHERE s.user_id = $1 ORDER BY s.created_at`,
      [userId]
    );
    const feedback = await zeilen('SELECT to_jsonb(x) AS z FROM feedback_submissions x WHERE user_id = $1 ORDER BY created_at', [userId]);
    const presence = await zeilen('SELECT to_jsonb(a) AS z FROM active_sessions a WHERE user_id = $1', [userId]);

    return { exported_at: new Date().toISOString(), account, memberships, chat_sessions, feedback, presence };
  }
}
