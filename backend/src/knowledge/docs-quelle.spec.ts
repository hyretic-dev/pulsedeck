import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { ladeDokumentation } from './docs-quelle';
import { teileDokumentation } from './chunking';

const tmp = () => mkdtempSync(join(tmpdir(), 'docs-quelle-'));

describe('ladeDokumentation', () => {
  it('liest eine einzelne Markdown-Datei unverändert', async () => {
    const pfad = join(tmp(), 'DOCS.md');
    writeFileSync(pfad, '# Handbuch\n\n## Abschnitt\n\nText.\n');
    expect(await ladeDokumentation(pfad)).toBe('# Handbuch\n\n## Abschnitt\n\nText.\n');
  });

  it('liest ein Verzeichnis: Frontmatter entfernt, Titel als Überschrift, sortiert nach order', async () => {
    const ordner = tmp();
    writeFileSync(join(ordner, 'b.md'), '---\ntitle: "Zweiter Teil"\norder: 20\n---\n\nInhalt B mit genug Text, damit der Abschnitt lang genug ist.\n');
    writeFileSync(join(ordner, 'a.md'), '---\ntitle: Erster Teil\norder: 10\n---\nInhalt A mit genug Text, damit der Abschnitt lang genug ist.\n\n### Unterpunkt\n\nMehr Text dazu.\n');
    writeFileSync(join(ordner, 'notizen.txt'), 'wird ignoriert');
    mkdirSync(join(ordner, 'unterordner'));

    const text = await ladeDokumentation(ordner);

    expect(text).not.toContain('---');
    expect(text).not.toContain('order:');
    expect(text.indexOf('## Erster Teil')).toBeGreaterThanOrEqual(0);
    expect(text.indexOf('## Erster Teil')).toBeLessThan(text.indexOf('## Zweiter Teil'));
    expect(text).not.toContain('wird ignoriert');
    expect(teileDokumentation(text).map((d) => d.titel)).toEqual(['Erster Teil', 'Unterpunkt', 'Zweiter Teil']);
  });

  it('fällt ohne Titel im Frontmatter auf den Dateinamen zurück', async () => {
    const ordner = tmp();
    writeFileSync(join(ordner, 'erste-schritte.md'), '---\norder: 1\n---\nGenug Text für einen Abschnitt, der nicht zu kurz ist.\n');
    expect(await ladeDokumentation(ordner)).toContain('## erste-schritte');
  });

  it('wirft bei fehlendem Pfad', async () => {
    await expect(ladeDokumentation(join(tmp(), 'gibt-es-nicht'))).rejects.toThrow();
  });
});
