import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { FilesystemObjectStorage } from './object-storage';

describe('FilesystemObjectStorage', () => {
  let dir: string;
  let speicher: FilesystemObjectStorage;
  const org = '10000000-0000-4000-8000-000000000001';
  const datei = '20000000-0000-4000-8000-000000000002';
  const key = `${org}/${datei}`;

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'pulsedeck-storage-test-'));
    speicher = new FilesystemObjectStorage(dir);
  });
  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('speichert, liest und löscht Inhalte atomar ohne Temp-Reste', async () => {
    await speicher.put(key, Buffer.from('Hallo Welt'));

    const { stream, size } = await speicher.get(key);
    const gelesen = await new Promise<string>((ok, nein) => {
      const teile: Buffer[] = [];
      stream.on('data', (t) => { teile.push(Buffer.from(t)); }).on('end', () => ok(Buffer.concat(teile).toString())).on('error', nein);
    });
    expect(gelesen).toBe('Hallo Welt');
    expect(size).toBe(10);
    expect(await readdir(join(dir, org))).toEqual([datei]);
    expect(await readFile(join(dir, key), 'utf8')).toBe('Hallo Welt');

    await speicher.delete(key);
    await expect(speicher.get(key)).rejects.toThrow();
    await speicher.delete(key); // idempotent
  });

  it('verweigert Schlüssel, die keine Org-/Datei-UUIDs sind (kein Pfadausbruch)', async () => {
    for (const falsch of ['../../etc/passwd', `${org}/../${datei}`, `${org}/${datei}/x`, `/${org}/${datei}`, 'a/b', `${org}/${datei}\0`, '']) {
      await expect(speicher.put(falsch, Buffer.from('x')), JSON.stringify(falsch)).rejects.toThrow('Ungültiger Speicherschlüssel');
      await expect(speicher.get(falsch)).rejects.toThrow('Ungültiger Speicherschlüssel');
      await expect(speicher.delete(falsch)).rejects.toThrow('Ungültiger Speicherschlüssel');
    }
  });
});
