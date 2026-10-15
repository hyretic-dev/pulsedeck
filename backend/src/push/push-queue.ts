import type { Queryable } from '../common/db';

export interface PushEintrag {
  organizationId: string;
  kind: 'event' | 'feed';
  refId: string;
  title: string;
  message: string;
  url: string;
}

/** Reiht eine Push-Benachrichtigung in derselben Transaktion wie die auslösende Änderung ein (Ersatz der DB-Trigger des Bestands). */
export async function reihePushEin(db: Queryable, e: PushEintrag): Promise<void> {
  await db.query(
    'INSERT INTO push_notification_queue (organization_id, kind, ref_id, title, message, url) VALUES ($1, $2, $3, $4, $5, $6)',
    [e.organizationId, e.kind, e.refId, e.title.slice(0, 200), e.message.slice(0, 200), e.url]
  );
}

/** Kurztext für die Benachrichtigung: Tags entfernt, auf 100 Zeichen gekürzt. */
export function pushKurztext(inhalt: string | null | undefined): string {
  return (inhalt ?? '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 100);
}
