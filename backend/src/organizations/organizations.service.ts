import { Inject, Injectable } from '@nestjs/common';
import type { Pool } from 'pg';

import { schreibeAudit } from '../common/audit';
import { PG_FEHLER, inTransaction, istPgFehler } from '../common/db';
import { konflikt, nichtGefunden, ungueltig } from '../common/http-error';
import { PG_POOL } from '../infrastructure/postgres/pg.pool';

import {
  RESERVIERTE_SLUGS,
  STANDARD_ROLLEN,
  STANDARD_SKILLS,
  slugify,
} from './organization-defaults';

/** Spalten, die nach außen gehen. `owner_id` (Konto-UUID) gehört nicht dazu. */
export const ORG_SPALTEN =
  'id, slug, name, description, logo_url, primary_color, subscription_tier, max_members, branding_enabled, created_at, updated_at';

export interface Organisation {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  logo_url: string | null;
  primary_color: string;
  subscription_tier: string;
  max_members: number;
  branding_enabled: boolean;
  created_at: Date;
  updated_at: Date;
}

export interface UpdateInput {
  name?: string;
  description?: string | null;
  primary_color?: string;
  logo_url?: string | null;
}

const SLUG_MUSTER = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/** Datum wie `toLocaleDateString('de-DE')` im Bestand (Europe/Berlin). */
function deutschesDatum(jetzt = new Date()): string {
  return new Intl.DateTimeFormat('de-DE', { timeZone: 'Europe/Berlin' }).format(jetzt);
}

@Injectable()
export class OrganizationsService {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  /** Normalisiert und prüft einen Slug (Länge, Zeichen, reservierte Routen). */
  pruefeSlug(roh: string): string {
    const slug = slugify(roh);
    if (slug.length < 3 || slug.length > 50 || !SLUG_MUSTER.test(slug)) {
      throw ungueltig('Die URL muss 3 bis 50 Zeichen lang sein und darf nur Buchstaben, Ziffern und Bindestriche enthalten');
    }
    if (RESERVIERTE_SLUGS.has(slug)) {
      throw ungueltig('Diese URL ist reserviert');
    }
    return slug;
  }

  async istSlugFrei(roh: string): Promise<boolean> {
    const slug = slugify(roh);
    if (slug.length < 3) return false;
    const { rowCount } = await this.pool.query('SELECT 1 FROM organizations WHERE slug = $1', [slug]);
    return (rowCount ?? 0) === 0 && !RESERVIERTE_SLUGS.has(slug);
  }

  async findePerSlug(slug: string): Promise<Organisation | null> {
    const { rows } = await this.pool.query<Organisation>(
      `SELECT ${ORG_SPALTEN} FROM organizations WHERE slug = $1`,
      [slug.toLowerCase()]
    );
    return rows[0] ?? null;
  }

  async findePerId(id: string): Promise<Organisation> {
    const { rows } = await this.pool.query<Organisation>(
      `SELECT ${ORG_SPALTEN} FROM organizations WHERE id = $1`,
      [id]
    );
    if (!rows[0]) throw nichtGefunden('Organisation');
    return rows[0];
  }

  /**
   * Legt Organisation, Standardrollen, Standard-Skills und das Besitzer-Mitglied (Admin) in einer
   * Transaktion an. Ersetzt die Bestands-Trigger und die zweistufige Frontend-Logik, bei der das
   * Besitzer-Mitglied nach einem Fehler fehlen konnte. Die Eindeutigkeit des Slugs macht den
   * Ablauf bei Wiederholung sicher: ein zweiter Versuch endet mit 409, nie mit einer Dublette.
   */
  async anlegen(
    userId: string,
    eingabe: { name: string; slug: string; ownerName?: string }
  ): Promise<Organisation> {
    const slug = this.pruefeSlug(eingabe.slug);
    const name = eingabe.name.trim();
    if (name.length < 1) throw ungueltig('Name fehlt');

    const konto = await this.pool.query<{ email: string }>('SELECT email::text AS email FROM auth_users WHERE id = $1', [userId]);
    const email = konto.rows[0]?.email;
    if (!email) throw nichtGefunden('Konto');
    const mitgliedsname = eingabe.ownerName?.trim() || email.split('@')[0] || 'Admin';

    try {
      return await inTransaction(this.pool, async (db) => {
        const org = await db.query<Organisation & { owner_id: string }>(
          `INSERT INTO organizations (slug, name, owner_id) VALUES ($1, $2, $3)
           RETURNING ${ORG_SPALTEN}, owner_id`,
          [slug, name, userId]
        );
        const angelegt = org.rows[0];

        const adminRolle = await db.query<{ id: string }>(
          `INSERT INTO organization_roles (organization_id, name, description, is_system_admin, is_default, permissions)
           VALUES ($1, $2, $3, true, false, $4) RETURNING id`,
          [angelegt.id, STANDARD_ROLLEN[0].name, STANDARD_ROLLEN[0].description, [...STANDARD_ROLLEN[0].permissions]]
        );
        await db.query(
          `INSERT INTO organization_roles (organization_id, name, description, is_system_admin, is_default, permissions)
           VALUES ($1, $2, $3, false, true, $4)`,
          [angelegt.id, STANDARD_ROLLEN[1].name, STANDARD_ROLLEN[1].description, [...STANDARD_ROLLEN[1].permissions]]
        );

        await db.query(
          `INSERT INTO skills (organization_id, name, category, icon, sort_order)
           SELECT $1, s.name, s.category, s.icon, s.sort_order
             FROM unnest($2::text[], $3::text[], $4::text[], $5::int[]) AS s(name, category, icon, sort_order)
           ON CONFLICT (organization_id, name) DO NOTHING`,
          [
            angelegt.id,
            STANDARD_SKILLS.map((s) => s.name),
            STANDARD_SKILLS.map((s) => s.category),
            STANDARD_SKILLS.map((s) => s.icon),
            STANDARD_SKILLS.map((s) => s.sortOrder),
          ]
        );

        const mitglied = await db.query<{ id: string }>(
          `INSERT INTO members (organization_id, user_id, role_id, app_role, role, name, status, email, join_date)
           VALUES ($1, $2, $3, 'admin', 'Admin', $4, 'Active', $5, $6) RETURNING id`,
          [angelegt.id, userId, adminRolle.rows[0].id, mitgliedsname, email, deutschesDatum()]
        );

        await schreibeAudit(db, {
          table: 'organizations',
          operation: 'INSERT',
          recordId: angelegt.id,
          newData: angelegt,
          performedBy: userId,
          organizationId: angelegt.id,
        });
        await schreibeAudit(db, {
          table: 'members',
          operation: 'INSERT',
          recordId: mitglied.rows[0].id,
          newData: { id: mitglied.rows[0].id, organization_id: angelegt.id, user_id: userId, app_role: 'admin' },
          performedBy: userId,
          organizationId: angelegt.id,
        });

        const { owner_id: _besitzer, ...oeffentlich } = angelegt;
        return oeffentlich;
      });
    } catch (fehler) {
      if (istPgFehler(fehler, PG_FEHLER.EINDEUTIG)) {
        throw konflikt('slug_taken', 'Diese URL ist bereits vergeben');
      }
      throw fehler;
    }
  }

  async aendern(userId: string, orgId: string, eingabe: UpdateInput): Promise<Organisation> {
    const felder = (Object.keys(eingabe) as Array<keyof UpdateInput>).filter((k) => eingabe[k] !== undefined);
    if (felder.length === 0) return this.findePerId(orgId);

    return inTransaction(this.pool, async (db) => {
      const alt = await db.query<Organisation>(`SELECT ${ORG_SPALTEN} FROM organizations WHERE id = $1 FOR UPDATE`, [orgId]);
      if (!alt.rows[0]) throw nichtGefunden('Organisation');
      const set = felder.map((feld, i) => `${feld} = $${i + 2}`).join(', ');
      const neu = await db.query<Organisation>(
        `UPDATE organizations SET ${set}, updated_at = now() WHERE id = $1 RETURNING ${ORG_SPALTEN}`,
        [orgId, ...felder.map((f) => eingabe[f])]
      );
      await schreibeAudit(db, {
        table: 'organizations',
        operation: 'UPDATE',
        recordId: orgId,
        oldData: alt.rows[0],
        newData: neu.rows[0],
        performedBy: userId,
        organizationId: orgId,
      });
      return neu.rows[0];
    });
  }

  /** Organisationen, in denen das Konto Besitzer oder Mitglied ist (Ersatz für getMyOrganizations). */
  async meineOrganisationen(userId: string): Promise<Organisation[]> {
    const { rows } = await this.pool.query<Organisation>(
      `SELECT ${ORG_SPALTEN} FROM organizations o
        WHERE o.owner_id = $1
           OR EXISTS (SELECT 1 FROM members m WHERE m.organization_id = o.id AND m.user_id = $1)
        ORDER BY o.name`,
      [userId]
    );
    return rows;
  }

  async mitgliederzahl(orgId: string): Promise<number> {
    const { rows } = await this.pool.query<{ n: string }>('SELECT count(*) AS n FROM members WHERE organization_id = $1', [orgId]);
    return Number(rows[0].n);
  }

  /**
   * Inhalte der öffentlichen Organisationsseite in einer Antwort (Ersatz für sechs Einzelabfragen
   * des Bestands). Öffentlich sind nur Termine mit Rolle `public`, veröffentlichte öffentliche
   * Wiki-Dokumente und freigegebene öffentliche Beiträge; Kontakte nur mit den Feldern, die die
   * Seite zeigt. Im Bestand las anonym alles (04-rechte-matrix.md, D4).
   */
  async oeffentlicheUebersicht(orgId: string): Promise<Record<string, unknown>> {
    const heute = new Date().toISOString().split('T')[0];
    const [anzahl, termine, wiki, beitraege, gruppen, kontakte] = await Promise.all([
      this.mitgliederzahl(orgId),
      this.pool.query(
        `SELECT id, title, date, start_time, end_time, location, description FROM events
          WHERE organization_id = $1 AND date >= $2 AND 'public' = ANY(allowed_roles)
          ORDER BY date ASC LIMIT 6`,
        [orgId, heute]
      ),
      this.pool.query(
        `SELECT d.id, d.title, d.content, jsonb_build_object('name', c.name) AS wiki_categories
           FROM wiki_docs d JOIN wiki_categories c ON c.id = d.category
          WHERE d.organization_id = $1 AND d.status = 'Published' AND d.allowed_roles = '{public}'
            AND d.working_group_id IS NULL
          ORDER BY d.title ASC LIMIT 6`,
        [orgId]
      ),
      this.pool.query(
        `SELECT id, title, content, created_at FROM feed_items
          WHERE organization_id = $1 AND is_public = true AND status IN ('approved', 'sent')
          ORDER BY created_at DESC LIMIT 50`,
        [orgId]
      ),
      this.pool.query(
        'SELECT id, name, description FROM working_groups WHERE organization_id = $1 ORDER BY name ASC',
        [orgId]
      ),
      this.pool.query(
        'SELECT id, name, role, email, phone, image_url FROM contacts WHERE organization_id = $1 ORDER BY name ASC LIMIT 5',
        [orgId]
      ),
    ]);
    return {
      member_count: anzahl,
      events: termine.rows,
      wiki_docs: wiki.rows,
      feed_items: beitraege.rows,
      working_groups: gruppen.rows,
      contacts: kontakte.rows,
    };
  }
}
