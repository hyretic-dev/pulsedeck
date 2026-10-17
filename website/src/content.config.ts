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
  }),
});

export const collections = { handbook };
