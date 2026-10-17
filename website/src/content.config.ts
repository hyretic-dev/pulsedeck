import { defineCollection } from 'astro:content';
import { glob } from 'astro/loaders';
import { z } from 'astro/zod';

/**
 * Handbuch: eine Markdown-Datei je Kapitel, Metadaten im Frontmatter.
 * Das Backend liest dasselbe Verzeichnis (DOCS_FILE) für die Wissensbasis der KI: title wird dort zur Überschrift,
 * order bestimmt die Reihenfolge. Frontmatter-Felder also nicht umbenennen, ohne backend/src/knowledge/docs-quelle.ts anzupassen.
 */
const handbook = defineCollection({
  loader: glob({ pattern: '*.md', base: './src/content/handbook' }),
  schema: z.object({
    title: z.string(),
    description: z.string(),
    order: z.number(),
    icon: z.string().default('pi-book'),
    /** Kapitel aus Fragen (### Frage) und Antworten: wird zusätzlich als FAQPage ausgezeichnet. */
    faq: z.boolean().default(false),
  }),
});

/**
 * Blog: eine Markdown-Datei je Beitrag. `draft: true` blendet einen Beitrag in Übersicht, Feed und Sitemap aus.
 * Dateiname = URL (/blog/<dateiname>).
 */
const blog = defineCollection({
  loader: glob({ pattern: '*.md', base: './src/content/blog' }),
  schema: z.object({
    title: z.string(),
    description: z.string(),
    date: z.coerce.date(),
    updated: z.coerce.date().optional(),
    author: z.string().default('PulseDeck'),
    tags: z.array(z.string()).default([]),
    draft: z.boolean().default(false),
    /** Vorschaubild (Pfad unter public/, z. B. /og/blog/beitrag.png); ohne Angabe das PulseDeck-Bild. */
    image: z.string().optional(),
    /** Häufige Fragen zum Beitrag: werden am Ende angezeigt und als FAQPage ausgezeichnet. Antworten kurz und eigenständig halten. */
    faq: z.array(z.object({ frage: z.string(), antwort: z.string() })).default([]),
  }),
});

export const collections = { handbook, blog };
