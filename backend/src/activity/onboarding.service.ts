import { Inject, Injectable } from '@nestjs/common';
import type { Pool } from 'pg';

import { nichtGefunden } from '../common/http-error';
import { PG_POOL } from '../infrastructure/postgres/pg.pool';
import type { Membership } from '../tenancy/membership';

/** Onboarding-Fortschritt und persönliche Aufgaben des Mitglieds (ersetzt direkte Tabellenzugriffe des Browsers). */
@Injectable()
export class OnboardingService {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  async fortschritt(aufrufer: Membership): Promise<{ completed_steps: string[]; has_tasks: boolean }> {
    const { rows } = await this.pool.query<{ step_key: string }>('SELECT step_key FROM onboarding_progress WHERE member_id = $1 ORDER BY completed_at', [aufrufer.member.id]);
    const aufgaben = await this.pool.query('SELECT 1 FROM user_tasks WHERE member_id = $1 LIMIT 1', [aufrufer.member.id]);
    return { completed_steps: rows.map((r) => r.step_key), has_tasks: (aufgaben.rowCount ?? 0) > 0 };
  }

  async schrittAbschliessen(aufrufer: Membership, schluessel: string): Promise<void> {
    await this.pool.query('INSERT INTO onboarding_progress (member_id, step_key) VALUES ($1, $2) ON CONFLICT (member_id, step_key) DO NOTHING', [aufrufer.member.id, schluessel]);
  }

  async aufgaben(aufrufer: Membership): Promise<Array<{ id: string; title: string; done: boolean }>> {
    const { rows } = await this.pool.query('SELECT id, title, done FROM user_tasks WHERE member_id = $1 ORDER BY created_at DESC', [aufrufer.member.id]);
    return rows;
  }

  async aufgabeAnlegen(aufrufer: Membership, titel: string): Promise<{ id: string; title: string; done: boolean }> {
    const { rows } = await this.pool.query('INSERT INTO user_tasks (member_id, title, done) VALUES ($1, $2, false) RETURNING id, title, done', [aufrufer.member.id, titel.trim()]);
    return rows[0];
  }

  async aufgabeAendern(aufrufer: Membership, id: string, eingabe: { title?: string; done?: boolean }): Promise<{ id: string; title: string; done: boolean }> {
    const felder = (['title', 'done'] as const).filter((k) => eingabe[k] !== undefined);
    const { rows } = await this.pool.query(
      felder.length === 0
        ? 'SELECT id, title, done FROM user_tasks WHERE id = $1 AND member_id = $2'
        : `UPDATE user_tasks SET ${felder.map((k, i) => `${k} = $${i + 3}`).join(', ')}, updated_at = now() WHERE id = $1 AND member_id = $2 RETURNING id, title, done`,
      [id, aufrufer.member.id, ...felder.map((k) => (k === 'title' ? eingabe.title?.trim() : eingabe[k]))]
    );
    if (!rows[0]) throw nichtGefunden('Aufgabe'); // fremde Aufgaben gibt es nicht
    return rows[0];
  }

  async aufgabeLoeschen(aufrufer: Membership, id: string): Promise<void> {
    const { rowCount } = await this.pool.query('DELETE FROM user_tasks WHERE id = $1 AND member_id = $2', [id, aufrufer.member.id]);
    if (!rowCount) throw nichtGefunden('Aufgabe');
  }
}
