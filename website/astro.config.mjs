import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';
import tailwindcss from '@tailwindcss/vite';
import { readdirSync, readFileSync } from 'node:fs';

// Adresse der Website selbst (kanonische URLs, Sitemap). Wird beim Bauen gesetzt (Docker-Build-Argument PUBLIC_SITE_URL).
const site = (process.env.PUBLIC_SITE_URL || 'https://pulsedeck.de').replace(/\/+$/, '');

// lastmod für die Sitemap: Blogbeiträge aus dem Frontmatter (updated, sonst date). Andere Seiten ohne Datum – ein erfundenes
// "heute" bei jedem Build würde Suchmaschinen nur das Vertrauen in lastmod nehmen.
const blogDaten = new Map(
  readdirSync('./src/content/blog')
    .filter((f) => f.endsWith('.md'))
    .map((f) => {
      const kopf = /^---\n([\s\S]*?)\n---/.exec(readFileSync(`./src/content/blog/${f}`, 'utf8'))?.[1] ?? '';
      const wert = (k) => new RegExp(`^${k}:\\s*["']?([0-9-]+)`, 'm').exec(kopf)?.[1];
      return [`${site}/blog/${f.replace(/\.md$/, '')}`, wert('updated') ?? wert('date')];
    })
);

export default defineConfig({
  site,
  output: 'static',
  trailingSlash: 'never',
  build: { format: 'file' },
  integrations: [
    sitemap({
      serialize(item) {
        const datum = blogDaten.get(item.url.replace(/\/$/, ''));
        return datum ? { ...item, lastmod: new Date(datum).toISOString() } : item;
      },
    }),
  ],
  vite: { plugins: [tailwindcss()] },
});
