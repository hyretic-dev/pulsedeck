import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { MigrationError } from './errors';

export interface TableManifest {
  table: string;
  source: string;
  /** Optionale Quelltabelle, die im Bestand nicht existiert. */
  missingInSource?: boolean;
  columns: string[];
  /** SQL-Ausdrücke der Prüfsumme (identisch auf Quelle und Ziel ausgewertet). */
  compare: string[];
  sourceRows: number;
  exportedRows: number;
  excluded?: { rows: number; reason: string };
  file: string;
  fileSha256: string;
  checksum: string;
  perOrg?: Record<string, number>;
}

export interface StorageObject {
  fileId: string;
  organizationId: string;
  sourcePath: string;
  size: number;
  sha256: string;
  /** Pfad relativ zum Exportverzeichnis. */
  file: string;
}

export interface Manifest {
  formatVersion: 1;
  createdAt: string;
  source: {
    database: string;
    serverVersion: string;
    extensions: string[];
    authProviders: Record<string, number>;
    buckets: { id: string; public: boolean; objects: number }[];
    tableSizes: Record<string, number>;
  };
  tables: TableManifest[];
  storage: {
    included: boolean;
    objects: StorageObject[];
    missing: { fileId: string; sourcePath: string }[];
  };
  skippedTables: Record<string, string>;
  /** Gesetzt, wenn der Export auf eine Organisation beschränkt wurde (`--only-org`). */
  scope?: { slug: string; organizationId: string; keepAccounts: string[] };
}

export const MANIFEST_DATEI = 'manifest.json';

export async function schreibeJson(pfad: string, inhalt: unknown): Promise<void> {
  const temp = `${pfad}.tmp`;
  await writeFile(temp, `${JSON.stringify(inhalt, null, 2)}\n`);
  await rename(temp, pfad);
}

export async function liesManifest(dir: string): Promise<{ manifest: Manifest; sha256: string }> {
  let roh: string;
  try {
    roh = await readFile(join(dir, MANIFEST_DATEI), 'utf8');
  } catch {
    throw new MigrationError('EXPORT_CORRUPT', `Kein ${MANIFEST_DATEI} im Exportverzeichnis`);
  }
  const manifest = JSON.parse(roh) as Manifest;
  if (manifest.formatVersion !== 1) throw new MigrationError('EXPORT_CORRUPT', `Unbekannte Manifest-Version ${String(manifest.formatVersion)}`);
  return { manifest, sha256: createHash('sha256').update(roh).digest('hex') };
}

export function sha256Datei(pfad: string): Promise<{ sha256: string; size: number }> {
  return new Promise((ok, nein) => {
    const hash = createHash('sha256');
    let size = 0;
    createReadStream(pfad)
      .on('data', (teil) => {
        hash.update(teil);
        size += teil.length;
      })
      .on('error', nein)
      .on('end', () => ok({ sha256: hash.digest('hex'), size }));
  });
}
