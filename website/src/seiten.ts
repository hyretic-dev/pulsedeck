import { getCollection } from 'astro:content';
import { beitraege } from './blog';
import { SITE_URL } from './config';
import { STANDARD_BILD } from './seo';
import { FUNKTIONEN } from './data/funktionen';
import { ZIELGRUPPEN } from './data/zielgruppen';

export interface Seite {
  pfad: string;
  titel: string;
  gruppe: 'Allgemein' | 'Funktionen' | 'Für wen' | 'Handbuch' | 'Blog' | 'Rechtliches';
  /** Letzte inhaltliche Änderung; nur wenn bekannt (kein Build-Datum, das würde lastmod entwerten). */
  geaendert?: Date;
  /** Vorschaubild (absolute URL) für die Bild-Erweiterung der Sitemap. */
  bild?: string;
}

/**
 * Alle indexierbaren Seiten der Website: Quelle für sitemap.xml und die Seitenübersicht (/sitemap).
 * Neue feste Seiten hier eintragen; scripts/pruefe-sitemap.mjs bricht den Build ab, wenn eine gebaute Seite fehlt.
 */
export async function alleSeiten(): Promise<Seite[]> {
  const kapitel = (await getCollection('handbook')).sort((a, b) => a.data.order - b.data.order);
  const posts = await beitraege();
  return [
    { pfad: '/', titel: 'Startseite', gruppe: 'Allgemein', bild: STANDARD_BILD },
    { pfad: '/funktionen', titel: 'Funktionen', gruppe: 'Funktionen' },
    ...FUNKTIONEN.map((f) => ({ pfad: `/funktionen/${f.slug}`, titel: f.name, gruppe: 'Funktionen' as const, bild: SITE_URL + f.bild.src })),
    ...ZIELGRUPPEN.map((z) => ({ pfad: `/${z.slug}`, titel: `PulseDeck für ${z.name}`, gruppe: 'Für wen' as const })),
    { pfad: '/preise', titel: 'Preise', gruppe: 'Allgemein' },
    { pfad: '/sicherheit', titel: 'Datenschutz & Sicherheit', gruppe: 'Allgemein' },
    { pfad: '/faq', titel: 'Häufige Fragen', gruppe: 'Allgemein' },
    { pfad: '/blog', titel: 'Blog', gruppe: 'Blog', geaendert: posts[0]?.data.updated ?? posts[0]?.data.date },
    ...posts.map((b) => ({
      pfad: `/blog/${b.id}`,
      titel: b.data.title,
      gruppe: 'Blog' as const,
      geaendert: b.data.updated ?? b.data.date,
      bild: b.data.image ? SITE_URL + b.data.image : STANDARD_BILD,
    })),
    { pfad: '/handbuch', titel: 'Handbuch', gruppe: 'Handbuch' },
    ...kapitel.map((k) => ({ pfad: `/handbuch/${k.id}`, titel: k.data.title, gruppe: 'Handbuch' as const, geaendert: k.data.updated })),
    { pfad: '/sitemap', titel: 'Seitenübersicht', gruppe: 'Allgemein' },
    { pfad: '/impressum', titel: 'Impressum', gruppe: 'Rechtliches' },
    { pfad: '/datenschutz', titel: 'Datenschutzerklärung', gruppe: 'Rechtliches' },
  ];
}

export const absolut = (pfad: string) => (pfad === '/' ? `${SITE_URL}/` : SITE_URL + pfad);
