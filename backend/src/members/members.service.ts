import { Inject, Injectable } from '@nestjs/common';
import type { Pool, PoolClient } from 'pg';

import { AuthService } from '../auth/auth.service';
import { schreibeAudit } from '../common/audit';
import { meldeAenderung } from '../common/changes';
import { PG_FEHLER, inTransaction, istPgFehler } from '../common/db';
import { konflikt, nichtGefunden, ungueltig } from '../common/http-error';
import { PG_POOL } from '../infrastructure/postgres/pg.pool';
import type { Membership } from '../tenancy/membership';
import { isAdmin } from '../tenancy/permissions';

/** Alle Spalten, die nach außen gehen: nie `connection_token`, nie fremde `calendar_token`. */
const VOLL = `id, organization_id, name, role, department, status, email::text AS email, join_date, avatar_url,
  user_id, app_role, COALESCE(permissions, '{}') AS permissions, role_id, street, zip_code, city, phone, birthday,
  custom_info, COALESCE(contact_channels, '{}') AS contact_channels, created_at, updated_at`;
/** Verzeichnis für normale Mitglieder: Name und Rolle, keine Kontaktdaten. */
const VERZEICHNIS = 'id, organization_id, name, role, department, status, avatar_url, app_role';

export type MitgliedsZeile = Record<string, unknown> & { id: string; user_id: string | null };

const BEARBEITBAR = [
  'name', 'email', 'role', 'department', 'status', 'join_date', 'avatar_url', 'role_id', 'app_role', 'permissions',
  'street', 'zip_code', 'city', 'phone', 'birthday', 'custom_info', 'contact_channels',
] as const;
const IMPORTIERBAR = [
  'name', 'email', 'role', 'department', 'status', 'join_date', 'street', 'zip_code', 'city', 'phone', 'birthday', 'custom_info',
] as const;
const PROFIL = ['phone', 'street', 'zip_code', 'city', 'birthday', 'avatar_url', 'contact_channels'] as const;

/** Datum wie `toLocaleDateString('de-DE')` im Bestand. */
function deutschesDatum(): string {
  return new Intl.DateTimeFormat('de-DE', { timeZone: 'Europe/Berlin' }).format(new Date());
}

function auswahl<T extends string>(eingabe: Record<string, unknown>, erlaubt: readonly T[]): Array<[T, unknown]> {
  return erlaubt.filter((k) => eingabe[k] !== undefined).map((k) => [k, eingabe[k]]);
}

@Injectable()
export class MembersService {
  constructor(
    @Inject(PG_POOL) private readonly pool: Pool,
    private readonly auth: AuthService
  ) {}

  /**
   * Mitgliederliste. Administratoren und Vorstand sehen alle Stammdaten (ohne Tokens), normale
   * Mitglieder nur das Verzeichnis (Name, Rolle, Abteilung). Im Bestand sah jedes Mitglied alle
   * Kontaktdaten, Geburtstage und Kalender-Token aller anderen.
   */
  async liste(orgId: string, aufrufer: Membership): Promise<MitgliedsZeile[]> {
    const voll = isAdmin(aufrufer) || aufrufer.member.app_role === 'committee';
    const { rows } = await this.pool.query<MitgliedsZeile>(
      `SELECT ${voll ? VOLL : VERZEICHNIS} FROM members WHERE organization_id = $1 ORDER BY name ASC`,
      [orgId]
    );
    return rows;
  }

  private async pruefeKapazitaet(db: PoolClient, orgId: string, neu: number): Promise<void> {
    // Zeile sperren: parallele Anlagen werden nacheinander gezählt (kein Überschreiten durch Race).
    const org = await db.query<{ subscription_tier: string; max_members: number }>(
      'SELECT subscription_tier, max_members FROM organizations WHERE id = $1 FOR UPDATE',
      [orgId]
    );
    if (!org.rows[0]) throw nichtGefunden('Organisation');
    if (org.rows[0].subscription_tier !== 'free') return;
    const { rows } = await db.query<{ n: string }>('SELECT count(*) AS n FROM members WHERE organization_id = $1', [orgId]);
    if (Number(rows[0].n) + neu > org.rows[0].max_members) {
      throw konflikt('member_limit_reached', `Das Mitgliederlimit von ${org.rows[0].max_members} Mitgliedern ist erreicht`);
    }
  }

  private async rolle(db: PoolClient, orgId: string, roleId?: string): Promise<{ id: string; is_system_admin: boolean }> {
    const { rows } = roleId
      ? await db.query('SELECT id, COALESCE(is_system_admin, false) AS is_system_admin FROM organization_roles WHERE id = $1 AND organization_id = $2', [roleId, orgId])
      : await db.query('SELECT id, COALESCE(is_system_admin, false) AS is_system_admin FROM organization_roles WHERE organization_id = $1 AND is_default ORDER BY name LIMIT 1', [orgId]);
    if (!rows[0]) {
      throw roleId ? ungueltig('Die Rolle gehört nicht zu dieser Organisation') : konflikt('no_default_role', 'Die Organisation hat keine Standardrolle');
    }
    return rows[0];
  }

  async anlegen(userId: string, orgId: string, eingabe: Record<string, unknown>): Promise<MitgliedsZeile> {
    try {
      return await inTransaction(this.pool, async (db) => {
        await this.pruefeKapazitaet(db, orgId, 1);
        const rolle = await this.rolle(db, orgId, eingabe.role_id as string | undefined);
        const werte: Record<string, unknown> = {
          status: 'Active',
          role: 'Mitglied',
          join_date: deutschesDatum(),
          ...Object.fromEntries(auswahl(eingabe, BEARBEITBAR)),
          role_id: rolle.id,
          // Systemadministrator-Rollen und app_role admin gehören zusammen (Bestand: zwei Modelle parallel).
          app_role: rolle.is_system_admin ? 'admin' : (eingabe.app_role ?? 'member'),
        };
        const spalten = Object.keys(werte);
        const { rows } = await db.query<MitgliedsZeile>(
          `INSERT INTO members (organization_id, ${spalten.join(', ')})
           VALUES ($1, ${spalten.map((_, i) => `$${i + 2}`).join(', ')}) RETURNING ${VOLL}`,
          [orgId, ...spalten.map((s) => (s === 'contact_channels' ? JSON.stringify(werte[s]) : werte[s]))]
        );
        await schreibeAudit(db, { table: 'members', operation: 'INSERT', recordId: rows[0].id, newData: rows[0], performedBy: userId, organizationId: orgId });
        await meldeAenderung(db, { table: 'members', organizationId: orgId, operation: 'INSERT', id: rows[0].id });
        return rows[0];
      });
    } catch (fehler) {
      if (istPgFehler(fehler, PG_FEHLER.EINDEUTIG)) throw konflikt('email_taken', 'Ein Mitglied mit dieser E-Mail existiert bereits');
      throw fehler;
    }
  }

  /**
   * Import (CSV-Zuordnung im Frontend): vorhandene E-Mails werden aktualisiert, neue angelegt, alles in
   * einer Transaktion. Nur Stammdaten; Rolle, Rechte und Konto-Verknüpfung bleiben unangetastet.
   */
  async importieren(userId: string, orgId: string, eintraege: Array<Record<string, unknown>>): Promise<MitgliedsZeile[]> {
    // Doppelte E-Mails in der Datei: der letzte Eintrag gewinnt.
    const eindeutig = new Map<string, Record<string, unknown>>();
    for (const e of eintraege) eindeutig.set(String(e.email).toLowerCase(), e);

    return inTransaction(this.pool, async (db) => {
      const vorhandene = await db.query<{ id: string; email: string }>(
        'SELECT id, email::text AS email FROM members WHERE organization_id = $1 AND email = ANY($2::citext[]) FOR UPDATE',
        [orgId, [...eindeutig.keys()]]
      );
      const nachEmail = new Map(vorhandene.rows.map((r) => [r.email.toLowerCase(), r.id]));
      const neu = [...eindeutig.keys()].filter((e) => !nachEmail.has(e)).length;
      if (neu > 0) await this.pruefeKapazitaet(db, orgId, neu);
      const standardRolle = neu > 0 ? await this.rolle(db, orgId) : null;

      const ergebnis: MitgliedsZeile[] = [];
      for (const [email, eintrag] of eindeutig) {
        const felder = auswahl(eintrag, IMPORTIERBAR).filter(([k]) => k !== 'email');
        const vorhandenId = nachEmail.get(email);
        if (vorhandenId) {
          if (felder.length === 0) {
            const { rows } = await db.query<MitgliedsZeile>(`SELECT ${VOLL} FROM members WHERE id = $1`, [vorhandenId]);
            ergebnis.push(rows[0]);
            continue;
          }
          const alt = await db.query(`SELECT ${VOLL} FROM members WHERE id = $1`, [vorhandenId]);
          const { rows } = await db.query<MitgliedsZeile>(
            `UPDATE members SET ${felder.map(([k], i) => `${k} = $${i + 2}`).join(', ')}, updated_at = now() WHERE id = $1 RETURNING ${VOLL}`,
            [vorhandenId, ...felder.map(([, v]) => v)]
          );
          await schreibeAudit(db, { table: 'members', operation: 'UPDATE', recordId: vorhandenId, oldData: alt.rows[0], newData: rows[0], performedBy: userId, organizationId: orgId });
          ergebnis.push(rows[0]);
        } else {
          const werte: Record<string, unknown> = {
            status: 'Active',
            role: 'Mitglied',
            join_date: deutschesDatum(),
            ...Object.fromEntries(felder),
            email,
            role_id: standardRolle!.id,
            app_role: 'member',
          };
          const spalten = Object.keys(werte);
          const { rows } = await db.query<MitgliedsZeile>(
            `INSERT INTO members (organization_id, ${spalten.join(', ')}) VALUES ($1, ${spalten.map((_, i) => `$${i + 2}`).join(', ')}) RETURNING ${VOLL}`,
            [orgId, ...spalten.map((s) => werte[s])]
          );
          await schreibeAudit(db, { table: 'members', operation: 'INSERT', recordId: rows[0].id, newData: rows[0], performedBy: userId, organizationId: orgId });
          ergebnis.push(rows[0]);
        }
      }
      await meldeAenderung(db, { table: 'members', organizationId: orgId, operation: 'UPDATE', id: null });
      return ergebnis;
    });
  }

  /** Anzahl der Administratoren (ohne `ausser`), die tatsächlich Admin-Rechte haben. */
  private async anzahlAdmins(db: PoolClient, orgId: string, ausser: string[]): Promise<number> {
    const { rows } = await db.query<{ n: string }>(
      `SELECT count(*) AS n FROM members m JOIN organization_roles r ON r.id = m.role_id
        WHERE m.organization_id = $1 AND NOT (m.id = ANY($2::uuid[])) AND (r.is_system_admin OR m.app_role = 'admin')`,
      [orgId, ausser]
    );
    return Number(rows[0].n);
  }

  /** Ändern durch einen Administrator. Besitzer behält Admin-Rolle, die Organisation behält mindestens einen Admin. */
  async aendern(userId: string, orgId: string, memberId: string, eingabe: Record<string, unknown>): Promise<MitgliedsZeile> {
    const felder = auswahl(eingabe, BEARBEITBAR);
    try {
      return await inTransaction(this.pool, async (db) => {
        const alt = await db.query<MitgliedsZeile & { owner_id: string | null; role_is_system_admin: boolean }>(
          `SELECT m.id, m.organization_id, m.name, m.role, m.department, m.status, m.email::text AS email, m.join_date, m.avatar_url,
                  m.user_id, m.app_role, COALESCE(m.permissions, '{}') AS permissions, m.role_id, m.street, m.zip_code, m.city,
                  m.phone, m.birthday, m.custom_info, COALESCE(m.contact_channels, '{}') AS contact_channels, m.created_at, m.updated_at,
                  o.owner_id, COALESCE(r.is_system_admin, false) AS role_is_system_admin
             FROM members m JOIN organizations o ON o.id = m.organization_id
             JOIN organization_roles r ON r.id = m.role_id
            WHERE m.id = $1 AND m.organization_id = $2 FOR UPDATE OF m`,
          [memberId, orgId]
        );
        const vorher = alt.rows[0];
        if (!vorher) throw nichtGefunden('Mitglied');
        if (felder.length === 0) {
          const { owner_id: _o, role_is_system_admin: _r, ...ohneInterna } = vorher;
          return ohneInterna as MitgliedsZeile;
        }

        const werte: Record<string, unknown> = Object.fromEntries(felder);
        let neueRolleAdmin = vorher.role_is_system_admin;
        if (werte.role_id !== undefined) {
          const rolle = await this.rolle(db, orgId, werte.role_id as string);
          neueRolleAdmin = rolle.is_system_admin;
          // Rolle und app_role zusammenhalten: Admin-Rolle ⇒ admin; Wechsel zu normaler Rolle nimmt „admin“ zurück.
          if (rolle.is_system_admin) werte.app_role = 'admin';
          else if (werte.app_role === undefined && vorher.app_role === 'admin') werte.app_role = 'member';
        }
        const neuerAppRole = (werte.app_role ?? vorher.app_role) as string;

        const warAdmin = vorher.role_is_system_admin || vorher.app_role === 'admin';
        const bleibtAdmin = neueRolleAdmin || neuerAppRole === 'admin';
        const istBesitzer = vorher.user_id !== null && vorher.user_id === vorher.owner_id;
        if (istBesitzer && !bleibtAdmin) {
          throw konflikt('owner_protected', 'Dem Besitzer kann die Admin-Rolle nicht entzogen werden');
        }
        if (warAdmin && !bleibtAdmin && (await this.anzahlAdmins(db, orgId, [memberId])) === 0) {
          throw konflikt('last_admin', 'Die Organisation braucht mindestens einen Administrator');
        }

        const spalten = Object.keys(werte);
        const { rows } = await db.query<MitgliedsZeile>(
          `UPDATE members SET ${spalten.map((s, i) => `${s} = $${i + 3}`).join(', ')}, updated_at = now()
            WHERE id = $1 AND organization_id = $2 RETURNING ${VOLL}`,
          [memberId, orgId, ...spalten.map((s) => (s === 'contact_channels' ? JSON.stringify(werte[s]) : werte[s]))]
        );
        const { owner_id: _o, role_is_system_admin: _r, ...vorherOeffentlich } = vorher;
        await schreibeAudit(db, { table: 'members', operation: 'UPDATE', recordId: memberId, oldData: vorherOeffentlich, newData: rows[0], performedBy: userId, organizationId: orgId });
        await meldeAenderung(db, { table: 'members', organizationId: orgId, operation: 'UPDATE', id: memberId });
        return rows[0];
      });
    } catch (fehler) {
      if (istPgFehler(fehler, PG_FEHLER.EINDEUTIG)) throw konflikt('email_taken', 'Ein Mitglied mit dieser E-Mail existiert bereits');
      throw fehler;
    }
  }

  /** Eigenes Profil (Profilseite): nur persönliche Angaben. */
  async profilAendern(userId: string, aufrufer: Membership, eingabe: Record<string, unknown>): Promise<MitgliedsZeile> {
    const felder = auswahl(eingabe, PROFIL);
    const orgId = aufrufer.member.organization_id;
    if (felder.length === 0) {
      const { rows } = await this.pool.query<MitgliedsZeile>(`SELECT ${VOLL} FROM members WHERE id = $1`, [aufrufer.member.id]);
      return rows[0];
    }
    return inTransaction(this.pool, async (db) => {
      const alt = await db.query(`SELECT ${VOLL} FROM members WHERE id = $1 FOR UPDATE`, [aufrufer.member.id]);
      const { rows } = await db.query<MitgliedsZeile>(
        `UPDATE members SET ${felder.map(([k], i) => `${k} = $${i + 2}`).join(', ')}, updated_at = now() WHERE id = $1 RETURNING ${VOLL}`,
        [aufrufer.member.id, ...felder.map(([k, v]) => (k === 'contact_channels' ? JSON.stringify(v) : v))]
      );
      await schreibeAudit(db, { table: 'members', operation: 'UPDATE', recordId: aufrufer.member.id, oldData: alt.rows[0], newData: rows[0], performedBy: userId, organizationId: orgId });
      await meldeAenderung(db, { table: 'members', organizationId: orgId, operation: 'UPDATE', id: aufrufer.member.id });
      return rows[0];
    });
  }

  /**
   * Löscht Mitglieder (einzeln oder mehrere) in einer Transaktion. Der Besitzer und der letzte
   * Administrator bleiben geschützt. Konten ohne verbleibende Mitgliedschaft und ohne eigene
   * Organisation werden mitgelöscht; ein Konto mit Mitgliedschaften in anderen Organisationen
   * bleibt bestehen (im Bestand löschte die Funktion jede übergebene Konto-ID, geprüft nur auf
   * „Admin irgendwo“).
   */
  async loeschen(userId: string, orgId: string, ids: string[]): Promise<void> {
    await inTransaction(this.pool, async (db) => {
      const gefunden = await db.query<{ id: string; user_id: string | null; owner_id: string | null }>(
        `SELECT m.id, m.user_id, o.owner_id FROM members m JOIN organizations o ON o.id = m.organization_id
          WHERE m.organization_id = $1 AND m.id = ANY($2::uuid[]) FOR UPDATE OF m`,
        [orgId, ids]
      );
      if (gefunden.rows.length !== new Set(ids).size) throw nichtGefunden('Mitglied');
      if (gefunden.rows.some((r) => r.user_id !== null && r.user_id === r.owner_id)) {
        throw konflikt('owner_protected', 'Der Besitzer kann die Organisation nicht verlassen. Bitte übertrage zuerst den Besitz.');
      }
      if ((await this.anzahlAdmins(db, orgId, ids)) === 0) {
        const betroffeneAdmins = await db.query(
          `SELECT 1 FROM members m JOIN organization_roles r ON r.id = m.role_id
            WHERE m.id = ANY($1::uuid[]) AND (r.is_system_admin OR m.app_role = 'admin')`,
          [ids]
        );
        if ((betroffeneAdmins.rowCount ?? 0) > 0) throw konflikt('last_admin', 'Die Organisation braucht mindestens einen Administrator');
      }

      const geloescht = await db.query<MitgliedsZeile>(`DELETE FROM members WHERE organization_id = $1 AND id = ANY($2::uuid[]) RETURNING ${VOLL}`, [orgId, ids]);
      for (const zeile of geloescht.rows) {
        await schreibeAudit(db, { table: 'members', operation: 'DELETE', recordId: zeile.id, oldData: zeile, performedBy: userId, organizationId: orgId });
      }
      const konten = geloescht.rows.map((r) => r.user_id).filter((u): u is string => u !== null);
      if (konten.length > 0) {
        await db.query(
          `DELETE FROM auth_users a WHERE a.id = ANY($1::uuid[])
             AND NOT EXISTS (SELECT 1 FROM members m WHERE m.user_id = a.id)
             AND NOT EXISTS (SELECT 1 FROM organizations o WHERE o.owner_id = a.id)`,
          [konten]
        );
      }
      await meldeAenderung(db, { table: 'members', organizationId: orgId, operation: 'DELETE', id: ids.length === 1 ? ids[0] : null });
    });
  }

  private async mitgliedMitOrg(orgId: string, memberId: string): Promise<{ id: string; email: string; user_id: string | null; organization_name: string }> {
    const { rows } = await this.pool.query(
      `SELECT m.id, m.email::text AS email, m.user_id, o.name AS organization_name
         FROM members m JOIN organizations o ON o.id = m.organization_id WHERE m.id = $1 AND m.organization_id = $2`,
      [memberId, orgId]
    );
    if (!rows[0]) throw nichtGefunden('Mitglied');
    return rows[0];
  }

  /**
   * Einladung (Ersatz von invite-member). Die Einladung geht immer an die **gespeicherte** Adresse
   * des Mitglieds (der Bestand schickte sie an eine frei übergebene Adresse und verknüpfte das
   * Mitglied damit beliebig). Ein bestätigtes Konto erhält einen Passwort-Reset-Link.
   */
  async einladen(userId: string, orgId: string, memberId: string): Promise<{ message: string; type: string; userId: string }> {
    const mitglied = await this.mitgliedMitOrg(orgId, memberId);
    const ergebnis = await this.auth.ladeEin(mitglied.email, mitglied.organization_name);
    try {
      await inTransaction(this.pool, async (db) => {
        const verknuepft = await db.query(
          `UPDATE members SET user_id = $3, updated_at = now()
            WHERE id = $1 AND organization_id = $2 AND (user_id IS NULL OR user_id = $3) RETURNING id`,
          [memberId, orgId, ergebnis.userId]
        );
        if ((verknuepft.rowCount ?? 0) === 0) throw konflikt('member_linked', 'Das Mitglied ist bereits mit einem anderen Konto verknüpft');
        await schreibeAudit(db, { table: 'members', operation: 'UPDATE', recordId: memberId, newData: { user_id: ergebnis.userId, invited: true }, performedBy: userId, organizationId: orgId });
        await meldeAenderung(db, { table: 'members', organizationId: orgId, operation: 'UPDATE', id: memberId });
      });
    } catch (fehler) {
      if (istPgFehler(fehler, PG_FEHLER.EINDEUTIG)) throw konflikt('already_member', 'Das Konto ist bereits Mitglied dieser Organisation');
      throw fehler;
    }
    return {
      message: ergebnis.mode === 'reset' ? 'Passwort-Reset E-Mail gesendet' : 'Invitation sent successfully',
      type: ergebnis.mode,
      userId: ergebnis.userId,
    };
  }

  /** Anmelde-Link zum Weitergeben (Ersatz von generate-magic-link); Einschränkung siehe AuthService. */
  async weitergabeLink(userId: string, orgId: string, memberId: string): Promise<{ success: boolean; link: string; expiresIn: string; message: string }> {
    const mitglied = await this.mitgliedMitOrg(orgId, memberId);
    const ergebnis = await this.auth.erzeugeWeitergabeLink(mitglied.email);
    await inTransaction(this.pool, async (db) => {
      await db.query(
        'UPDATE members SET user_id = $3, updated_at = now() WHERE id = $1 AND organization_id = $2 AND user_id IS NULL',
        [memberId, orgId, ergebnis.userId]
      );
      await schreibeAudit(db, { table: 'members', operation: 'UPDATE', recordId: memberId, newData: { share_link_created: true }, performedBy: userId, organizationId: orgId });
    });
    return {
      success: true,
      link: ergebnis.link,
      expiresIn: `${ergebnis.expiresInMinutes} Minuten`,
      message: ergebnis.created ? 'Einladungs-Link generiert (neuer Account)' : 'Einladungs-Link generiert (eingeladenes Konto)',
    };
  }
}

