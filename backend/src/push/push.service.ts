import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Pool } from 'pg';

import { apiFehler, ungueltig } from '../common/http-error';
import { APP_CONFIG, type AppConfig } from '../config/configuration';
import { sichtbarkeitsAusdruck } from '../events/visibility';
import { PG_POOL } from '../infrastructure/postgres/pg.pool';
import type { Membership } from '../tenancy/membership';

import { istErlaubterPushEndpoint } from './push-endpoint';
import { PUSH_SENDER, PushFehler, type PushSender } from './push-sender';

const MAX_ABOS_JE_MITGLIED = 20;
const MAX_VERSUCHE = 5;

interface Abo {
  id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
}

/** Rang eines Mitglieds in SQL (wie `sichtbarkeitsRang`): Besitzer/System-Admin/Admin 3, Vorstand 2, sonst 1. */
const RANG_SQL = `(CASE WHEN o.owner_id = m.user_id OR COALESCE(r.is_system_admin, false) OR m.app_role = 'admin' THEN 3 WHEN m.app_role = 'committee' THEN 2 ELSE 1 END)`;
const AG_SQL = `ARRAY(SELECT working_group_id FROM ag_memberships WHERE member_id = m.id UNION SELECT working_group_id FROM working_group_members WHERE member_id = m.id)`;

@Injectable()
export class PushService {
  private readonly logger = new Logger('Push');

  constructor(
    @Inject(PG_POOL) private readonly pool: Pool,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(PUSH_SENDER) private readonly sender: PushSender | null
  ) {}

  konfiguration(): { enabled: boolean; publicKey: string | null } {
    return { enabled: !!this.config.push, publicKey: this.config.push?.publicKey ?? null };
  }

  async abonnieren(aufrufer: Membership, endpoint: string, keys: { p256dh: string; auth: string }): Promise<void> {
    if (!this.config.push) throw apiFehler(503, 'push_disabled', 'Push-Benachrichtigungen sind nicht eingerichtet');
    if (!istErlaubterPushEndpoint(endpoint)) throw ungueltig('Die Adresse gehört nicht zu einem unterstützten Push-Dienst');
    const { rows } = await this.pool.query<{ n: string; vorhanden: boolean }>(
      'SELECT count(*) AS n, bool_or(endpoint = $2) AS vorhanden FROM push_subscriptions WHERE member_id = $1',
      [aufrufer.member.id, endpoint]
    );
    if (!rows[0].vorhanden && Number(rows[0].n) >= MAX_ABOS_JE_MITGLIED) throw apiFehler(409, 'too_many_subscriptions', 'Zu viele Geräte für dieses Mitglied angemeldet');
    await this.pool.query(
      `INSERT INTO push_subscriptions (member_id, endpoint, p256dh, auth) VALUES ($1, $2, $3, $4)
       ON CONFLICT (member_id, endpoint) DO UPDATE SET p256dh = EXCLUDED.p256dh, auth = EXCLUDED.auth, updated_at = now()`,
      [aufrufer.member.id, endpoint, keys.p256dh, keys.auth]
    );
  }

  async abbestellen(aufrufer: Membership, endpoint: string): Promise<void> {
    await this.pool.query('DELETE FROM push_subscriptions WHERE member_id = $1 AND endpoint = $2', [aufrufer.member.id, endpoint]);
  }

  /** Empfänger-Abos: Termine nur für Mitglieder, die den Termin sehen dürfen; Beiträge für alle Mitglieder der Organisation. */
  private async abos(eintrag: { organization_id: string; kind: string; ref_id: string }): Promise<Abo[]> {
    const gemeinsam = `FROM push_subscriptions s JOIN members m ON m.id = s.member_id JOIN organizations o ON o.id = m.organization_id
                       LEFT JOIN organization_roles r ON r.id = m.role_id`;
    if (eintrag.kind === 'event') {
      const { rows } = await this.pool.query<Abo>(
        `SELECT s.id, s.endpoint, s.p256dh, s.auth ${gemeinsam} JOIN events e ON e.id = $2
          WHERE m.organization_id = $1 AND e.organization_id = $1 AND ${sichtbarkeitsAusdruck(RANG_SQL, AG_SQL)}`,
        [eintrag.organization_id, eintrag.ref_id]
      );
      return rows;
    }
    const { rows } = await this.pool.query<Abo>(`SELECT s.id, s.endpoint, s.p256dh, s.auth ${gemeinsam} WHERE m.organization_id = $1`, [eintrag.organization_id]);
    return rows;
  }

  /** Arbeitet die Warteschlange ab (mehrere Instanzen sicher); entfernt abgelaufene Abos. */
  async verarbeiten(batch = 10): Promise<{ verarbeitet: number; zugestellt: number }> {
    const { rows } = await this.pool.query(
      `WITH faellig AS (
         SELECT id FROM push_notification_queue
          WHERE status = 'pending' AND next_attempt_at <= now() AND (locked_until IS NULL OR locked_until < now())
          ORDER BY next_attempt_at LIMIT $1 FOR UPDATE SKIP LOCKED)
       UPDATE push_notification_queue q SET locked_until = now() + interval '5 minutes', attempts = q.attempts + 1
         FROM faellig WHERE q.id = faellig.id
       RETURNING q.id, q.organization_id, q.kind, q.ref_id, q.title, q.message, q.url, q.attempts`,
      [batch]
    );
    let zugestellt = 0;
    for (const eintrag of rows) {
      try {
        if (!this.sender) throw new Error('Push nicht eingerichtet');
        const nutzlast = JSON.stringify({ title: eintrag.title, body: eintrag.message, icon: '/assets/icons/icon-192x192.png', data: { url: eintrag.url } });
        const ergebnisse = await Promise.all(
          (await this.abos(eintrag)).map(async (abo) => {
            try {
              await this.sender!.send({ endpoint: abo.endpoint, keys: { p256dh: abo.p256dh, auth: abo.auth } }, nutzlast);
              return 'ok' as const;
            } catch (fehler) {
              if (fehler instanceof PushFehler && (fehler.status === 404 || fehler.status === 410)) {
                await this.pool.query('DELETE FROM push_subscriptions WHERE id = $1', [abo.id]);
                return 'abgelaufen' as const;
              }
              this.logger.warn(`Push an Abo ${abo.id} fehlgeschlagen: ${fehler instanceof Error ? fehler.message : 'unbekannt'}`);
              return 'fehler' as const;
            }
          })
        );
        zugestellt += ergebnisse.filter((e) => e === 'ok').length;
        const gesamtFehler = ergebnisse.length > 0 && ergebnisse.every((e) => e === 'fehler');
        if (gesamtFehler && eintrag.attempts < MAX_VERSUCHE) throw new Error('Alle Zustellungen fehlgeschlagen');
        await this.pool.query("UPDATE push_notification_queue SET status = $2, processed_at = now(), locked_until = NULL WHERE id = $1", [eintrag.id, gesamtFehler ? 'failed' : 'sent']);
      } catch (fehler) {
        const endgueltig = eintrag.attempts >= MAX_VERSUCHE;
        await this.pool.query(
          `UPDATE push_notification_queue SET status = $2, locked_until = NULL, last_error = $3, next_attempt_at = now() + make_interval(mins => $4) WHERE id = $1`,
          [eintrag.id, endgueltig ? 'failed' : 'pending', fehler instanceof Error ? fehler.message.slice(0, 300) : 'unbekannt', 2 ** (eintrag.attempts - 1)]
        );
      }
    }
    return { verarbeitet: rows.length, zugestellt };
  }
}
