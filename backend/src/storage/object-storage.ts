import { createReadStream, type ReadStream } from 'node:fs';
import { mkdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';

export const OBJECT_STORAGE = Symbol('OBJECT_STORAGE');

/** Speicher für Dateiinhalte. Der Schlüssel ist immer `<orgId>/<fileId>` (UUIDs, nie vom Client). */
export interface ObjectStorage {
  put(key: string, inhalt: Buffer): Promise<void>;
  get(key: string): Promise<{ stream: ReadStream; size: number }>;
  delete(key: string): Promise<void>;
}

const SCHLUESSEL = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Dateisystem-Adapter (Docker-Volume). Schlüsselprüfung verhindert Pfadausbrüche; Schreiben ist atomar (Temp-Datei + rename). */
export class FilesystemObjectStorage implements ObjectStorage {
  constructor(private readonly wurzel: string) {}

  private pfad(key: string): string {
    if (!SCHLUESSEL.test(key)) throw new Error('Ungültiger Speicherschlüssel');
    return join(this.wurzel, key);
  }

  async put(key: string, inhalt: Buffer): Promise<void> {
    const ziel = this.pfad(key);
    await mkdir(dirname(ziel), { recursive: true });
    const temp = `${ziel}.${randomUUID()}.tmp`;
    try {
      await writeFile(temp, inhalt, { flag: 'wx', mode: 0o640 });
      await rename(temp, ziel);
    } catch (fehler) {
      await rm(temp, { force: true });
      throw fehler;
    }
  }

  async get(key: string): Promise<{ stream: ReadStream; size: number }> {
    const ziel = this.pfad(key);
    const { size } = await stat(ziel);
    return { stream: createReadStream(ziel), size };
  }

  async delete(key: string): Promise<void> {
    await rm(this.pfad(key), { force: true });
  }
}
