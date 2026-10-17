import type { APIRoute } from 'astro';
import { absolut, alleSeiten } from '../seiten';

const xml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/**
 * XML-Sitemap (sitemaps.org) mit Bild-Erweiterung. changefreq und priority fehlen bewusst: Google ignoriert beide;
 * lastmod nur, wo das Datum der letzten inhaltlichen Änderung bekannt ist.
 */
export const GET: APIRoute = async () => {
  const eintraege = (await alleSeiten()).map((s) =>
    [
      '  <url>',
      `    <loc>${xml(absolut(s.pfad))}</loc>`,
      s.geaendert ? `    <lastmod>${s.geaendert.toISOString().split('T')[0]}</lastmod>` : '',
      s.bild ? `    <image:image><image:loc>${xml(s.bild)}</image:loc></image:image>` : '',
      '  </url>',
    ]
      .filter(Boolean)
      .join('\n')
  );
  return new Response(
    `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">\n${eintraege.join('\n')}\n</urlset>\n`,
    { headers: { 'Content-Type': 'application/xml; charset=utf-8' } }
  );
};
