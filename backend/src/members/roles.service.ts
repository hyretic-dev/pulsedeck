import { Inject, Injectable } from '@nestjs/common';
import type { Pool } from 'pg';

import { inTransaction, PG_FEHLER, istPgFehler } from '../common/db';
import { konflikt, nichtGefunden } from '../common/http-error';
import { PG_POOL } from '../infrastructure/postgres/pg.pool';
import { ROLLEN_SPALTEN } from '../infrastructure/postgres/pg.membership-repository';
import type { OrgRole } from '../tenancy/membership';

interface RolleEingabe {
  name?: string;
  description?: string | null;
  permissions?: string[];
  is_default?: boolean;
  is_system_admin?: boolean;
}

/** Benutzerdefinierte Rollen einer Organisation (Einstellungen → Rollen). Schreiben nur durch Administratoren. */
@Injectable()
export class RolesService {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  async anlegen(orgId: string, eingabe: RolleEingabe & { name: string }): Promise<OrgRole> {
    try {
      return await inTransaction(this.pool, async (db) => {
        if (eingabe.is_default) await db.query('UPDATE organization_roles SET is_default = false WHERE organization_id = $1', [orgId]);
        const { rows } = await db.query<OrgRole>(
          `INSERT INTO organization_roles (organization_id, name, description, permissions, is_default, is_system_admin)
           VALUES ($1, $2, $3, $4, $5, $6) RETURNING ${ROLLEN_SPALTEN}`,
          [orgId, eingabe.name.trim(), eingabe.description ?? null, eingabe.permissions ?? [], eingabe.is_default ?? false, eingabe.is_system_admin ?? false]
        );
        return rows[0];
      });
    } catch (fehler) {
      if (istPgFehler(fehler, PG_FEHLER.EINDEUTIG)) throw konflikt('role_name_taken', 'Eine Rolle mit diesem Namen existiert bereits');
      throw fehler;
    }
  }

  async aendern(orgId: string, roleId: string, eingabe: RolleEingabe): Promise<OrgRole> {
    try {
      return await inTransaction(this.pool, async (db) => {
        const alt = await db.query<OrgRole>(`SELECT ${ROLLEN_SPALTEN} FROM organization_roles WHERE id = $1 AND organization_id = $2 FOR UPDATE`, [roleId, orgId]);
        if (!alt.rows[0]) throw nichtGefunden('Rolle');

        if (eingabe.is_system_admin === false && alt.rows[0].is_system_admin) {
          // Der Besitzer und der letzte Administrator verlieren sonst ihre Rechte.
          const betroffen = await db.query(
            `SELECT 1 FROM members m JOIN organizations o ON o.id = m.organization_id
              WHERE m.role_id = $1 AND m.user_id IS NOT NULL AND m.user_id = o.owner_id`,
            [roleId]
          );
          if ((betroffen.rowCount ?? 0) > 0) throw konflikt('owner_protected', 'Dem Besitzer kann die Admin-Rolle nicht entzogen werden');
          const andere = await db.query(
            `SELECT 1 FROM members m JOIN organization_roles r ON r.id = m.role_id
              WHERE m.organization_id = $1 AND m.role_id <> $2 AND (r.is_system_admin OR m.app_role = 'admin') LIMIT 1`,
            [orgId, roleId]
          );
          const nutzer = await db.query('SELECT 1 FROM members WHERE role_id = $1 LIMIT 1', [roleId]);
          if ((nutzer.rowCount ?? 0) > 0 && (andere.rowCount ?? 0) === 0) {
            throw konflikt('last_admin', 'Die Organisation braucht mindestens einen Administrator');
          }
        }
        if (eingabe.is_default) await db.query('UPDATE organization_roles SET is_default = false WHERE organization_id = $1 AND id <> $2', [orgId, roleId]);

        const felder = (Object.keys(eingabe) as Array<keyof RolleEingabe>).filter((k) => eingabe[k] !== undefined);
        if (felder.length === 0) return alt.rows[0];
        const { rows } = await db.query<OrgRole>(
          `UPDATE organization_roles SET ${felder.map((k, i) => `${k} = $${i + 3}`).join(', ')}, updated_at = now()
            WHERE id = $1 AND organization_id = $2 RETURNING ${ROLLEN_SPALTEN}`,
          [roleId, orgId, ...felder.map((k) => (k === 'name' ? (eingabe.name as string).trim() : eingabe[k]))]
        );
        // Rolle bestimmt app_role der Zugeordneten mit (Admin-Rolle ⇔ admin), solange das Legacy-Modell mitläuft.
        if (eingabe.is_system_admin === true) await db.query("UPDATE members SET app_role = 'admin' WHERE role_id = $1", [roleId]);
        if (eingabe.is_system_admin === false && alt.rows[0].is_system_admin) {
          await db.query("UPDATE members SET app_role = 'member' WHERE role_id = $1 AND app_role = 'admin'", [roleId]);
        }
        return rows[0];
      });
    } catch (fehler) {
      if (istPgFehler(fehler, PG_FEHLER.EINDEUTIG)) throw konflikt('role_name_taken', 'Eine Rolle mit diesem Namen existiert bereits');
      throw fehler;
    }
  }

  /**
   * Löscht eine Rolle. Zugeordnete Mitglieder erhalten die Standardrolle (die Oberfläche warnt: „verlieren
   * diese Rechte“); der Bestand scheiterte dagegen am Fremdschlüssel. Systemadministrator-Rollen sind
   * nicht löschbar.
   */
  async loeschen(orgId: string, roleId: string): Promise<void> {
    await inTransaction(this.pool, async (db) => {
      const rolle = await db.query<OrgRole>(`SELECT ${ROLLEN_SPALTEN} FROM organization_roles WHERE id = $1 AND organization_id = $2 FOR UPDATE`, [roleId, orgId]);
      if (!rolle.rows[0]) throw nichtGefunden('Rolle');
      if (rolle.rows[0].is_system_admin) throw konflikt('system_role', 'Systemadministrator-Rollen können nicht gelöscht werden');

      const nutzer = await db.query('SELECT 1 FROM members WHERE role_id = $1 LIMIT 1', [roleId]);
      if ((nutzer.rowCount ?? 0) > 0) {
        const standard = await db.query<{ id: string }>(
          'SELECT id FROM organization_roles WHERE organization_id = $1 AND is_default AND id <> $2 LIMIT 1',
          [orgId, roleId]
        );
        if (!standard.rows[0]) throw konflikt('no_default_role', 'Es gibt keine andere Standardrolle für die zugeordneten Mitglieder');
        await db.query('UPDATE members SET role_id = $1, updated_at = now() WHERE role_id = $2', [standard.rows[0].id, roleId]);
      }
      await db.query('DELETE FROM organization_roles WHERE id = $1', [roleId]);
    });
  }
}
