import { randomUUID } from 'node:crypto';

import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Pool, PoolClient } from 'pg';

import { schreibeAudit } from '../common/audit';
import { meldeAenderung } from '../common/changes';
import { inTransaction } from '../common/db';
import { konflikt, nichtGefunden, ungueltig, verboten } from '../common/http-error';
import { sichtbarkeitsRang } from '../events/visibility';
import { PG_POOL } from '../infrastructure/postgres/pg.pool';
import { OBJECT_STORAGE, type ObjectStorage } from '../storage/object-storage';
import type { Membership } from '../tenancy/membership';
import { isAdmin } from '../tenancy/permissions';

import { dateiSichtbarkeitsBedingung } from './file-visibility';

type Db = Pick<Pool, 'query'> | Pick<PoolClient, 'query'>;

const FILE_SELECT = `f.id, f.name, f.original_name, f.storage_path, f.mime_type, f.size_bytes::float8 AS size_bytes, f.folder, f.folder_id, f.description,
  f.is_pinned, f.uploaded_by, f.working_group_id, f.visibility, f.organization_id, f.is_indexed, f.created_at, f.updated_at,
  CASE WHEN u.id IS NULL THEN NULL ELSE jsonb_build_object('name', u.name) END AS uploader,
  CASE WHEN g.id IS NULL THEN NULL ELSE jsonb_build_object('name', g.name) END AS working_group
  FROM files f LEFT JOIN members u ON u.id = f.uploaded_by LEFT JOIN working_groups g ON g.id = f.working_group_id`;

/** Im Browser darstellbare Typen; alles andere wird nur als Anhang ausgeliefert (kein ausführbares HTML/SVG aus Uploads). */
export const INLINE_TYPEN = ['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'application/pdf'];

export interface DateiZeile {
  id: string;
  name: string;
  mime_type: string | null;
  storage_path: string;
  uploaded_by: string | null;
  visibility: string;
  working_group_id: string | null;
  [spalte: string]: unknown;
}

export interface DateiFilter {
  folder_id?: string;
  pinned?: boolean;
  working_group_id?: string;
  q?: string;
  sort?: 'name' | 'recent';
  limit?: number;
}
export interface UploadMeta {
  folder_id?: string;
  visibility?: string;
  description?: string;
  working_group_id?: string;
}
export interface HochgeladeneDatei {
  originalname: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
}
export interface DateiAenderung {
  name?: string;
  description?: string | null;
  visibility?: string;
  working_group_id?: string | null;
  folder_id?: string | null;
  is_pinned?: boolean;
}

/** Dateiname aus dem Upload: UTF-8 statt latin1-Mojibake, ohne Pfadtrenner und Steuerzeichen. */
export function bereinigeDateinamen(roh: string): string {
  const dekodiert = Buffer.from(roh, 'latin1').toString('utf8');
  const name = (dekodiert.includes('�') ? roh : dekodiert)
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f\\/]/g, '_')
    .trim()
    .slice(0, 255);
  return name && name !== '.' && name !== '..' ? name : 'datei';
}

@Injectable()
export class FilesService {
  private readonly logger = new Logger('Files');

  constructor(
    @Inject(PG_POOL) private readonly pool: Pool,
    @Inject(OBJECT_STORAGE) private readonly speicher: ObjectStorage
  ) {}

  private async arbeitsgruppen(db: Db, memberId: string): Promise<string[]> {
    const { rows } = await db.query<{ working_group_id: string }>(
      'SELECT working_group_id FROM ag_memberships WHERE member_id = $1 UNION SELECT working_group_id FROM working_group_members WHERE member_id = $1',
      [memberId]
    );
    return rows.map((r) => r.working_group_id);
  }

  private async sichtParameter(db: Db, aufrufer: Membership): Promise<unknown[]> {
    return [aufrufer.member.id, sichtbarkeitsRang(aufrufer), await this.arbeitsgruppen(db, aufrufer.member.id)];
  }

  async liste(orgId: string, aufrufer: Membership, filter: DateiFilter): Promise<Record<string, unknown>[]> {
    const params: unknown[] = [orgId, ...(await this.sichtParameter(this.pool, aufrufer))];
    const bedingungen = ['f.organization_id = $1', dateiSichtbarkeitsBedingung(2)];
    if (filter.folder_id === 'root') bedingungen.push('f.folder_id IS NULL');
    else if (filter.folder_id) bedingungen.push(`f.folder_id = $${params.push(filter.folder_id)}`);
    if (filter.pinned !== undefined) bedingungen.push(`f.is_pinned = $${params.push(filter.pinned)}`);
    if (filter.working_group_id) bedingungen.push(`f.working_group_id = $${params.push(filter.working_group_id)}`);
    if (filter.q) bedingungen.push(`f.name ILIKE '%' || replace(replace(replace($${params.push(filter.q)}, '\\', '\\\\'), '%', '\\%'), '_', '\\_') || '%'`);
    const { rows } = await this.pool.query(
      `SELECT ${FILE_SELECT} WHERE ${bedingungen.join(' AND ')} ORDER BY ${filter.sort === 'recent' ? 'f.created_at DESC' : 'f.name ASC'} LIMIT ${Math.min(filter.limit ?? 200, 200)}`,
      params
    );
    return rows;
  }

  /** Metadaten einer Datei, wenn der Aufrufer sie sehen darf (sonst 404, die Existenz bleibt verborgen). */
  async einzeln(orgId: string, aufrufer: Membership, fileId: string, db: Db = this.pool): Promise<DateiZeile> {
    const { rows } = await db.query(`SELECT ${FILE_SELECT} WHERE f.id = $1 AND f.organization_id = $2 AND ${dateiSichtbarkeitsBedingung(3)}`, [fileId, orgId, ...(await this.sichtParameter(db, aufrufer))]);
    if (!rows[0]) throw nichtGefunden('Datei');
    return rows[0];
  }

  private async pruefeVerweise(db: Db, orgId: string, meta: { folder_id?: string | null; working_group_id?: string | null; visibility?: string }): Promise<void> {
    if (meta.folder_id) {
      const { rowCount } = await db.query('SELECT 1 FROM folders WHERE id = $1 AND organization_id = $2', [meta.folder_id, orgId]);
      if (!rowCount) throw ungueltig('Der Ordner gehört nicht zu dieser Organisation');
    }
    if (meta.working_group_id) {
      const { rowCount } = await db.query('SELECT 1 FROM working_groups WHERE id = $1 AND organization_id = $2', [meta.working_group_id, orgId]);
      if (!rowCount) throw ungueltig('Die Arbeitsgruppe gehört nicht zu dieser Organisation');
    }
  }

  async hochladen(userId: string, orgId: string, aufrufer: Membership, datei: HochgeladeneDatei, meta: UploadMeta): Promise<Record<string, unknown>> {
    const visibility = meta.visibility ?? 'member';
    if (visibility === 'ag-only' && !meta.working_group_id) throw ungueltig('„Nur Arbeitsgruppe“ braucht eine Arbeitsgruppe');
    const id = randomUUID();
    const key = `${orgId}/${id}`;
    await this.pruefeVerweise(this.pool, orgId, meta);
    if (meta.working_group_id && !isAdmin(aufrufer) && !(await this.arbeitsgruppen(this.pool, aufrufer.member.id)).includes(meta.working_group_id)) {
      throw verboten('Dateien lassen sich nur Arbeitsgruppen zuordnen, in denen du Mitglied bist');
    }
    await this.speicher.put(key, datei.buffer);
    try {
      return await inTransaction(this.pool, async (db) => {
        const name = bereinigeDateinamen(datei.originalname);
        await db.query(
          `INSERT INTO files (id, organization_id, name, original_name, storage_path, mime_type, size_bytes, folder, folder_id, description, uploaded_by, working_group_id, visibility)
           VALUES ($1, $2, $3, $3, $4, $5, $6, '/', $7, $8, $9, $10, $11)`,
          [id, orgId, name, key, datei.mimetype.slice(0, 200), datei.size, meta.folder_id ?? null, meta.description ?? null, aufrufer.member.id, meta.working_group_id ?? null, visibility]
        );
        const neu = await this.einzeln(orgId, aufrufer, id, db);
        await schreibeAudit(db, { table: 'files', operation: 'INSERT', recordId: id, newData: neu, performedBy: userId, organizationId: orgId });
        await meldeAenderung(db, { table: 'files', organizationId: orgId, operation: 'INSERT', id });
        return neu;
      });
    } catch (fehler) {
      await this.speicher.delete(key).catch(() => undefined); // keine verwaisten Inhalte, wenn die Metadaten scheitern
      throw fehler;
    }
  }

  private darfVerwalten(aufrufer: Membership, datei: { uploaded_by: string | null }): boolean {
    return isAdmin(aufrufer) || datei.uploaded_by === aufrufer.member.id;
  }

  async aendern(userId: string, orgId: string, aufrufer: Membership, fileId: string, eingabe: DateiAenderung): Promise<Record<string, unknown>> {
    return inTransaction(this.pool, async (db) => {
      await db.query('SELECT 1 FROM files WHERE id = $1 AND organization_id = $2 FOR UPDATE', [fileId, orgId]);
      const alt = await this.einzeln(orgId, aufrufer, fileId, db);
      if (!this.darfVerwalten(aufrufer, alt)) throw verboten();
      await this.pruefeVerweise(db, orgId, eingabe);
      const sichtbarkeit = eingabe.visibility ?? alt.visibility;
      const gruppe = eingabe.working_group_id !== undefined ? eingabe.working_group_id : alt.working_group_id;
      if (sichtbarkeit === 'ag-only' && !gruppe) throw ungueltig('„Nur Arbeitsgruppe“ braucht eine Arbeitsgruppe');
      const werte: Record<string, unknown> = {};
      if (eingabe.name !== undefined) werte.name = bereinigeDateinamen(eingabe.name);
      for (const feld of ['description', 'visibility', 'working_group_id', 'folder_id', 'is_pinned'] as const) if (eingabe[feld] !== undefined) werte[feld] = eingabe[feld];
      const spalten = Object.keys(werte);
      if (spalten.length === 0) return alt;
      await db.query(`UPDATE files SET ${spalten.map((s, i) => `${s} = $${i + 3}`).join(', ')}, updated_at = now() WHERE id = $1 AND organization_id = $2`, [fileId, orgId, ...spalten.map((s) => werte[s])]);
      const neu = await this.einzeln(orgId, aufrufer, fileId, db);
      await schreibeAudit(db, { table: 'files', operation: 'UPDATE', recordId: fileId, oldData: alt, newData: neu, performedBy: userId, organizationId: orgId });
      await meldeAenderung(db, { table: 'files', organizationId: orgId, operation: 'UPDATE', id: fileId });
      return neu;
    });
  }

  async loeschen(userId: string, orgId: string, aufrufer: Membership, fileId: string): Promise<void> {
    const schluessel = await inTransaction(this.pool, async (db) => {
      await db.query('SELECT 1 FROM files WHERE id = $1 AND organization_id = $2 FOR UPDATE', [fileId, orgId]);
      const alt = await this.einzeln(orgId, aufrufer, fileId, db);
      if (!this.darfVerwalten(aufrufer, alt)) throw verboten();
      await db.query('DELETE FROM files WHERE id = $1', [fileId]); // Wissensbasis-Abschnitte und Indexaufträge fallen per FK mit
      await schreibeAudit(db, { table: 'files', operation: 'DELETE', recordId: fileId, oldData: alt, performedBy: userId, organizationId: orgId });
      await meldeAenderung(db, { table: 'files', organizationId: orgId, operation: 'DELETE', id: fileId });
      return alt.storage_path;
    });
    // Nach dem Commit: Schlägt das Löschen des Inhalts fehl, bleibt nur ein unerreichbarer Rest im Volume (kein Datenleck).
    await this.speicher.delete(schluessel).catch((fehler) => this.logger.error(`Inhalt von ${fileId} nicht gelöscht: ${fehler instanceof Error ? fehler.message : 'unbekannt'}`));
  }

  /** Inhalt zum Ausliefern: Metadaten (nach Sichtbarkeitsprüfung) und Lese-Stream. */
  async oeffnen(orgId: string, aufrufer: Membership, fileId: string) {
    const datei = await this.einzeln(orgId, aufrufer, fileId);
    return { datei, ...(await this.speicher.get(datei.storage_path)) };
  }

  /** Öffentlich freigegebene Dateien (visibility `public`) ohne Anmeldung. */
  async oeffentlichOeffnen(fileId: string) {
    const { rows } = await this.pool.query("SELECT id, name, mime_type, storage_path FROM files WHERE id = $1 AND visibility = 'public'", [fileId]);
    if (!rows[0]) throw nichtGefunden('Datei');
    return { datei: rows[0], ...(await this.speicher.get(rows[0].storage_path)) };
  }

  // ── Ordner ──────────────────────────────────────────────────────────────────

  async ordner(orgId: string, aufrufer: Membership, parentId?: string): Promise<Record<string, unknown>[]> {
    const params: unknown[] = [orgId, ...(await this.sichtParameter(this.pool, aufrufer))];
    const { rows } = await this.pool.query(
      `SELECT d.id, d.name, d.parent_id, d.organization_id, d.created_by, d.created_at,
              (SELECT count(*)::int FROM files f WHERE f.folder_id = d.id AND f.organization_id = $1 AND ${dateiSichtbarkeitsBedingung(2)}) AS file_count
         FROM folders d WHERE d.organization_id = $1 AND ${!parentId || parentId === 'root' ? 'd.parent_id IS NULL' : `d.parent_id = $${params.push(parentId)}`}
        ORDER BY d.name ASC`,
      params
    );
    return rows;
  }

  private darfOrdnerAnlegen(aufrufer: Membership): boolean {
    return isAdmin(aufrufer) || aufrufer.member.app_role === 'committee';
  }

  async ordnerAnlegen(userId: string, orgId: string, aufrufer: Membership, name: string, parentId: string | null): Promise<Record<string, unknown>> {
    if (!this.darfOrdnerAnlegen(aufrufer)) throw verboten();
    return inTransaction(this.pool, async (db) => {
      if (parentId) {
        const { rowCount } = await db.query('SELECT 1 FROM folders WHERE id = $1 AND organization_id = $2', [parentId, orgId]);
        if (!rowCount) throw ungueltig('Der übergeordnete Ordner gehört nicht zu dieser Organisation');
      }
      const { rows } = await db.query(
        'INSERT INTO folders (name, parent_id, organization_id, created_by) VALUES ($1, $2, $3, $4) RETURNING id, name, parent_id, organization_id, created_by, created_at',
        [name.trim(), parentId, orgId, aufrufer.member.id]
      );
      await schreibeAudit(db, { table: 'folders', operation: 'INSERT', recordId: rows[0].id, newData: rows[0], performedBy: userId, organizationId: orgId });
      await meldeAenderung(db, { table: 'folders', organizationId: orgId, operation: 'INSERT', id: rows[0].id });
      return { ...rows[0], file_count: 0 };
    });
  }

  async ordnerUmbenennen(userId: string, orgId: string, aufrufer: Membership, folderId: string, name: string): Promise<Record<string, unknown>> {
    if (!this.darfOrdnerAnlegen(aufrufer)) throw verboten();
    return inTransaction(this.pool, async (db) => {
      const alt = await db.query('SELECT id, name, parent_id FROM folders WHERE id = $1 AND organization_id = $2 FOR UPDATE', [folderId, orgId]);
      if (!alt.rows[0]) throw nichtGefunden('Ordner');
      const { rows } = await db.query('UPDATE folders SET name = $2 WHERE id = $1 RETURNING id, name, parent_id, organization_id, created_by, created_at', [folderId, name.trim()]);
      await schreibeAudit(db, { table: 'folders', operation: 'UPDATE', recordId: folderId, oldData: alt.rows[0], newData: rows[0], performedBy: userId, organizationId: orgId });
      await meldeAenderung(db, { table: 'folders', organizationId: orgId, operation: 'UPDATE', id: folderId });
      return rows[0];
    });
  }

  /** Ordner löschen: nur Administratoren. Unterordner fallen mit, enthaltene Dateien landen wieder auf der obersten Ebene. */
  async ordnerLoeschen(userId: string, orgId: string, aufrufer: Membership, folderId: string): Promise<void> {
    if (!isAdmin(aufrufer)) throw verboten();
    await inTransaction(this.pool, async (db) => {
      const alt = await db.query('SELECT id, name, parent_id FROM folders WHERE id = $1 AND organization_id = $2 FOR UPDATE', [folderId, orgId]);
      if (!alt.rows[0]) throw nichtGefunden('Ordner');
      await db.query('DELETE FROM folders WHERE id = $1', [folderId]);
      await schreibeAudit(db, { table: 'folders', operation: 'DELETE', recordId: folderId, oldData: alt.rows[0], performedBy: userId, organizationId: orgId });
      await meldeAenderung(db, { table: 'folders', organizationId: orgId, operation: 'DELETE', id: folderId });
    });
  }
}
