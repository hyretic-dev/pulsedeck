import { readdir, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';

interface Seite {
  datei: string;
  titel: string;
  reihenfolge: number;
  inhalt: string;
}

/** Trennt den Frontmatter-Block (`---` … `---` am Dateianfang) vom Text; ohne Block bleibt der Text unverändert. */
function trenneFrontmatter(text: string): { felder: Record<string, string>; inhalt: string } {
  const treffer = /^﻿?---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/.exec(text);
  if (!treffer) return { felder: {}, inhalt: text };
  const felder: Record<string, string> = {};
  for (const zeile of treffer[1].split(/\r?\n/)) {
    const kv = /^([A-Za-z_][\w-]*):\s*(.*)$/.exec(zeile);
    if (kv) felder[kv[1]] = kv[2].trim().replace(/^(["'])(.*)\1$/, '$2');
  }
  return { felder, inhalt: text.slice(treffer[0].length) };
}

/**
 * Quelle der Produktdokumentation für die Wissensbasis: eine Markdown-Datei oder ein Verzeichnis mit Markdown-Dateien
 * (Handbuch der Website mit Frontmatter). Bei einem Verzeichnis werden die Dateien nach `order` (dann Dateiname) sortiert,
 * das Frontmatter entfällt und `title` wird zur Überschrift der Ebene 2.
 */
export async function ladeDokumentation(pfad: string): Promise<string> {
  if (!(await stat(pfad)).isDirectory()) return readFile(pfad, 'utf8');
  const dateien = (await readdir(pfad, { withFileTypes: true })).filter((e) => e.isFile() && /\.mdx?$/i.test(e.name)).map((e) => e.name);
  const seiten: Seite[] = [];
  for (const datei of dateien) {
    const { felder, inhalt } = trenneFrontmatter(await readFile(join(pfad, datei), 'utf8'));
    const reihenfolge = Number(felder.order);
    seiten.push({
      datei,
      titel: felder.title || datei.replace(/\.mdx?$/i, ''),
      reihenfolge: Number.isFinite(reihenfolge) && felder.order !== undefined && felder.order !== '' ? reihenfolge : Number.MAX_SAFE_INTEGER,
      inhalt: inhalt.trim(),
    });
  }
  seiten.sort((a, b) => a.reihenfolge - b.reihenfolge || a.datei.localeCompare(b.datei));
  return seiten.map((s) => `## ${s.titel}\n\n${s.inhalt}\n`).join('\n');
}
