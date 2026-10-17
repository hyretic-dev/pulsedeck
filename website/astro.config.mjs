import { defineConfig } from 'astro/config';
import tailwindcss from '@tailwindcss/vite';
import { rehypeCheckliste, rehypeKontextCta } from './src/markdown/rehype-pulsedeck.mjs';

// Adresse der Website selbst (kanonische URLs, Sitemap). Wird beim Bauen gesetzt (Docker-Build-Argument PUBLIC_SITE_URL).
const site = (process.env.PUBLIC_SITE_URL || 'https://pulsedeck.de').replace(/\/+$/, '');
// Wie APP_URL in src/config.ts (Registrieren-Links in Markdown-Inhalten)
const appUrl = (process.env.PUBLIC_APP_URL || 'https://app.pulsedeck.de').replace(/\/+$/, '');

// Sitemap: eigener Endpunkt src/pages/sitemap.xml.ts (mit lastmod aus dem Frontmatter und Vorschaubildern).
export default defineConfig({
  site,
  output: 'static',
  trailingSlash: 'never',
  build: { format: 'file' },
  markdown: { rehypePlugins: [rehypeCheckliste, [rehypeKontextCta, { appUrl }]] },
  vite: { plugins: [tailwindcss()] },
});
