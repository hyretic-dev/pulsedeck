import { Inject, Injectable } from '@nestjs/common';
import type { Pool } from 'pg';

import { schreibeAudit } from '../common/audit';
import { inTransaction } from '../common/db';
import { konflikt, nichtGefunden, ungueltig, verboten } from '../common/http-error';
import { APP_CONFIG, type AppConfig } from '../config/configuration';
import { PG_POOL } from '../infrastructure/postgres/pg.pool';
import { MAIL_DISPATCHER, type MailDispatcher } from '../mail/mail-dispatcher';
import { gastEinladungMail } from '../mail/mail-templates';
import type { Membership } from '../tenancy/membership';
import { isAdmin } from '../tenancy/permissions';

import { EventsService } from './events.service';

export interface GastEinladungEingabe {
  guest_organization_id?: string;
  guest_org_name?: string;
  guest_org_email?: string;
  guest_org_contact_name?: string;
}

const GAST_SPALTEN = `g.id, g.event_id, g.host_organization_id, g.guest_organization_id, g.guest_org_name, g.guest_org_email,
  g.guest_org_contact_name, g.status, g.invited_by, g.invited_at, g.responded_at`;

/** Gastorganisationen bei Terminen (Ersatz für die Edge Function send-guest-invitation und die direkten Tabellenzugriffe). */
@Injectable()
export class GuestsService {
  constructor(
    @Inject(PG_POOL) private readonly pool: Pool,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(MAIL_DISPATCHER) private readonly mail: MailDispatcher,
    private readonly events: EventsService
  ) {}

  private async ladeTermin(orgId: string, eventId: string): Promise<{ id: string; title: string; date: string; start_time: string; location: string; working_group_id: string | null }> {
    const { rows } = await this.pool.query(
      'SELECT id, title, date, start_time, location, working_group_id FROM events WHERE id = $1 AND organization_id = $2',
      [eventId, orgId]
    );
    if (!rows[0]) throw nichtGefunden('Termin');
    return rows[0];
  }

  /** Gäste eines sichtbaren Termins: Verwaltende sehen alle Einladungen, andere nur angenommene. */
  async liste(orgId: string, aufrufer: Membership, eventId: string): Promise<Record<string, unknown>[]> {
    const termin = await this.events.einzeln(orgId, aufrufer, eventId);
    const verwaltet = await this.events.darfVerwalten(this.pool, aufrufer, (termin.working_group_id as string | null) ?? null);
    const { rows } = await this.pool.query(
      `SELECT ${GAST_SPALTEN}, o.name AS organization_name, o.slug AS organization_slug, o.logo_url AS organization_logo_url
         FROM event_guest_organizations g LEFT JOIN organizations o ON o.id = g.guest_organization_id
        WHERE g.event_id = $1 AND g.host_organization_id = $2 ${verwaltet ? '' : "AND g.status = 'accepted'"}
        ORDER BY g.invited_at ASC`,
      [eventId, orgId]
    );
    // Kontaktdaten der Gäste sehen nur die Verwaltenden
    return verwaltet ? rows : rows.map(({ guest_org_email: _e, guest_org_contact_name: _c, ...rest }) => rest);
  }

  /** Suche nach bestehenden Organisationen (mindestens zwei Zeichen, höchstens zehn Treffer, ohne die eigene). */
  async suche(orgId: string, aufrufer: Membership, q: string): Promise<Array<{ id: string; name: string; slug: string; logo_url: string | null }>> {
    if (!(await this.darfEinladen(aufrufer))) throw verboten();
    const begriff = q.trim();
    if (begriff.length < 2) return [];
    const { rows } = await this.pool.query(
      `SELECT id, name, slug, logo_url FROM organizations
        WHERE id <> $1 AND name ILIKE '%' || replace(replace(replace($2, '\\', '\\\\'), '%', '\\%'), '_', '\\_') || '%'
        ORDER BY name ASC LIMIT 10`,
      [orgId, begriff]
    );
    return rows;
  }

  private async darfEinladen(aufrufer: Membership): Promise<boolean> {
    if (await this.events.darfVerwalten(this.pool, aufrufer, null)) return true;
    const { rowCount } = await this.pool.query("SELECT 1 FROM ag_memberships WHERE member_id = $1 AND role IN ('admin', 'lead') LIMIT 1", [aufrufer.member.id]);
    return (rowCount ?? 0) > 0;
  }

  async einladen(userId: string, orgId: string, aufrufer: Membership, eventId: string, eingabe: GastEinladungEingabe): Promise<Record<string, unknown>> {
    const termin = await this.ladeTermin(orgId, eventId);
    if (!(await this.events.darfVerwalten(this.pool, aufrufer, termin.working_group_id))) throw verboten();
    const istOrg = !!eingabe.guest_organization_id;
    if (!istOrg && !(eingabe.guest_org_name && eingabe.guest_org_email)) throw ungueltig('Gastorganisation oder Name und E-Mail der Gäste angeben');
    if (istOrg && eingabe.guest_organization_id === orgId) throw ungueltig('Die eigene Organisation kann nicht als Gast eingeladen werden');

    const einladung = await inTransaction(this.pool, async (db) => {
      let empfaenger: string | null = eingabe.guest_org_email ?? null;
      let gastName: string | null = eingabe.guest_org_name ?? null;
      if (istOrg) {
        const org = await db.query<{ name: string; owner_email: string | null }>(
          `SELECT o.name, u.email AS owner_email FROM organizations o LEFT JOIN auth_users u ON u.id = o.owner_id WHERE o.id = $1`,
          [eingabe.guest_organization_id]
        );
        if (!org.rows[0]) throw nichtGefunden('Organisation');
        empfaenger = org.rows[0].owner_email;
        gastName = org.rows[0].name;
      }
      const vorhanden = await db.query(
        `SELECT 1 FROM event_guest_organizations WHERE event_id = $1 AND (guest_organization_id = $2 OR lower(guest_org_email) = lower($3))`,
        [eventId, eingabe.guest_organization_id ?? null, istOrg ? null : eingabe.guest_org_email]
      );
      if ((vorhanden.rowCount ?? 0) > 0) throw konflikt('guest_already_invited', 'Diese Gäste sind bereits eingeladen');
      const { rows } = await db.query(
        `INSERT INTO event_guest_organizations (event_id, host_organization_id, guest_organization_id, guest_org_name, guest_org_email, guest_org_contact_name, status, invited_by)
         VALUES ($1, $2, $3, $4, $5, $6, 'pending', $7) RETURNING id`,
        [eventId, orgId, eingabe.guest_organization_id ?? null, istOrg ? null : eingabe.guest_org_name, istOrg ? null : eingabe.guest_org_email, istOrg ? null : (eingabe.guest_org_contact_name ?? null), aufrufer.member.id]
      );
      const geladen = await db.query(`SELECT ${GAST_SPALTEN} FROM event_guest_organizations g WHERE g.id = $1`, [rows[0].id]);
      await schreibeAudit(db, { table: 'event_guest_organizations', operation: 'INSERT', recordId: rows[0].id, newData: geladen.rows[0], performedBy: userId, organizationId: orgId });
      return { eintrag: geladen.rows[0], empfaenger, gastName };
    });

    if (einladung.empfaenger) {
      const gastgeber = await this.pool.query<{ name: string }>('SELECT name FROM organizations WHERE id = $1', [orgId]);
      await this.mail.dispatch(
        'gast-einladung',
        {
          to: einladung.empfaenger,
          ...gastEinladungMail({
            gastName: eingabe.guest_org_contact_name ?? einladung.gastName,
            gastgeber: gastgeber.rows[0]?.name ?? 'Eine Organisation',
            titel: termin.title,
            datum: termin.date,
            beginn: termin.start_time,
            ort: termin.location,
            link: `${this.config.appBaseUrl}/event/${termin.id}`,
          }),
        }
      );
    }
    return einladung.eintrag;
  }

  async entfernen(userId: string, orgId: string, aufrufer: Membership, eventId: string, gastId: string): Promise<void> {
    const termin = await this.ladeTermin(orgId, eventId);
    if (!(await this.events.darfVerwalten(this.pool, aufrufer, termin.working_group_id))) throw verboten();
    await inTransaction(this.pool, async (db) => {
      const { rows } = await db.query(`SELECT ${GAST_SPALTEN} FROM event_guest_organizations g WHERE g.id = $1 AND g.event_id = $2 AND g.host_organization_id = $3`, [gastId, eventId, orgId]);
      if (!rows[0]) throw nichtGefunden('Gast');
      await db.query('DELETE FROM event_guest_organizations WHERE id = $1', [gastId]);
      await schreibeAudit(db, { table: 'event_guest_organizations', operation: 'DELETE', recordId: gastId, oldData: rows[0], performedBy: userId, organizationId: orgId });
    });
  }

  // ── Sicht der eingeladenen Organisation ─────────────────────────────────────

  private pruefeGastRecht(aufrufer: Membership): void {
    if (!isAdmin(aufrufer) && aufrufer.member.app_role !== 'committee') throw verboten();
  }

  /** Offene Einladungen an die Organisation des Pfads (Vorstand/Admin), mit Termin und gastgebender Organisation. */
  async offeneEinladungen(orgId: string, aufrufer: Membership): Promise<Record<string, unknown>[]> {
    this.pruefeGastRecht(aufrufer);
    const { rows } = await this.pool.query(
      `SELECT ${GAST_SPALTEN},
              jsonb_build_object('id', e.id, 'title', e.title, 'date', e.date, 'start_time', e.start_time, 'location', e.location) AS event,
              jsonb_build_object('id', h.id, 'name', h.name, 'logo_url', h.logo_url) AS host_organization
         FROM event_guest_organizations g
         JOIN events e ON e.id = g.event_id JOIN organizations h ON h.id = g.host_organization_id
        WHERE g.guest_organization_id = $1 AND g.status = 'pending'
        ORDER BY g.invited_at DESC`,
      [orgId]
    );
    return rows;
  }

  /** Annehmen oder Ablehnen; nur die eingeladene Organisation, nur solange die Einladung offen ist. */
  async antworten(userId: string, orgId: string, aufrufer: Membership, einladungId: string, status: 'accepted' | 'declined'): Promise<Record<string, unknown>> {
    this.pruefeGastRecht(aufrufer);
    return inTransaction(this.pool, async (db) => {
      const { rows: alt } = await db.query(`SELECT ${GAST_SPALTEN} FROM event_guest_organizations g WHERE g.id = $1 AND g.guest_organization_id = $2 FOR UPDATE`, [einladungId, orgId]);
      if (!alt[0]) throw nichtGefunden('Einladung');
      if (alt[0].status !== 'pending') throw konflikt('invitation_answered', 'Auf diese Einladung wurde bereits geantwortet');
      await db.query('UPDATE event_guest_organizations SET status = $2, responded_at = now() WHERE id = $1', [einladungId, status]);
      const { rows } = await db.query(`SELECT ${GAST_SPALTEN} FROM event_guest_organizations g WHERE g.id = $1`, [einladungId]);
      await schreibeAudit(db, { table: 'event_guest_organizations', operation: 'UPDATE', recordId: einladungId, oldData: alt[0], newData: rows[0], performedBy: userId, organizationId: orgId });
      return rows[0];
    });
  }

  /** Termine anderer Organisationen, zu denen die Organisation als Gast zugesagt hat (Kalenderanzeige). */
  async gastTermine(orgId: string): Promise<Record<string, unknown>[]> {
    const { rows } = await this.pool.query(
      `SELECT e.id, e.title, e.date, e.start_time, e.end_time, e.location, e.description,
              jsonb_build_object('id', h.id, 'name', h.name, 'logo_url', h.logo_url) AS host_organization
         FROM event_guest_organizations g
         JOIN events e ON e.id = g.event_id JOIN organizations h ON h.id = g.host_organization_id
        WHERE g.guest_organization_id = $1 AND g.status = 'accepted'
        ORDER BY e.date ASC, e.start_time ASC`,
      [orgId]
    );
    return rows;
  }
}
