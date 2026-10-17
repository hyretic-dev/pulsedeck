import { defineConfig } from 'astro/config';
import tailwindcss from '@tailwindcss/vite';

// Adresse der Website selbst (kanonische URLs, Sitemap). Wird beim Bauen gesetzt (Docker-Build-Argument PUBLIC_SITE_URL).
const site = (process.env.PUBLIC_SITE_URL || 'https://pulsedeck.de').replace(/\/+$/, '');

// Sitemap: eigener Endpunkt src/pages/sitemap.xml.ts (mit lastmod aus dem Frontmatter und Vorschaubildern).
export default defineConfig({
  site,
  output: 'static',
  trailingSlash: 'never',
  build: { format: 'file' },
  vite: { plugins: [tailwindcss()] },
});
