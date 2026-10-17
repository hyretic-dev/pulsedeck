import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';
import tailwindcss from '@tailwindcss/vite';

// Adresse der Website selbst (kanonische URLs, Sitemap). Wird beim Bauen gesetzt (Docker-Build-Argument PUBLIC_SITE_URL).
const site = (process.env.PUBLIC_SITE_URL || 'https://pulsedeck.de').replace(/\/+$/, '');

export default defineConfig({
  site,
  output: 'static',
  trailingSlash: 'never',
  build: { format: 'file' },
  integrations: [sitemap()],
  vite: { plugins: [tailwindcss()] },
});
