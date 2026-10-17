import { KONTAKT, SITE_URL } from './config';

/** Stabile IDs der Kern-Entitäten; alle Seiten verweisen darauf, damit Suchmaschinen und KI-Systeme sie zusammenführen. */
export const ORG_ID = `${SITE_URL}/#organisation`;
export const WEBSITE_ID = `${SITE_URL}/#website`;
export const SOFTWARE_ID = `${SITE_URL}/#software`;

export const STANDARD_BILD = `${SITE_URL}/og/pulsedeck.png`;

export const organisation = {
  '@type': 'Organization',
  '@id': ORG_ID,
  name: 'PulseDeck',
  url: `${SITE_URL}/`,
  logo: { '@type': 'ImageObject', url: `${SITE_URL}/icons/icon-512x512.png`, width: 512, height: 512 },
  email: KONTAKT,
  contactPoint: { '@type': 'ContactPoint', contactType: 'customer support', email: KONTAKT, availableLanguage: ['de'] },
  sameAs: ['https://github.com/julienstack/pulsedeck'],
};

export const website = {
  '@type': 'WebSite',
  '@id': WEBSITE_ID,
  url: `${SITE_URL}/`,
  name: 'PulseDeck',
  inLanguage: 'de-DE',
  publisher: { '@id': ORG_ID },
};

/** Brotkrumen als schema.org BreadcrumbList; die Startseite steht immer vorn. */
export function brotkrumen(eintraege: Array<{ name: string; pfad: string }>) {
  return {
    '@type': 'BreadcrumbList',
    itemListElement: [{ name: 'PulseDeck', pfad: '/' }, ...eintraege].map((e, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      name: e.name,
      item: e.pfad === '/' ? `${SITE_URL}/` : SITE_URL + e.pfad,
    })),
  };
}

/** Lesezeit in Minuten (≈ 200 Wörter pro Minute, mindestens 1). */
export const lesezeit = (text: string) => Math.max(1, Math.round(text.trim().split(/\s+/).length / 200));

/**
 * Fragen und Antworten aus Markdown: jede Überschrift der Ebene 3 ist eine Frage, der Text bis zur nächsten Überschrift die Antwort.
 * Markdown-Auszeichnung wird für die strukturierten Daten entfernt.
 */
export function fragenAusMarkdown(markdown: string) {
  const klartext = (s: string) =>
    s
      .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
      .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
      .replace(/[*_`>#]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  return markdown
    .split(/^### /m)
    .slice(1)
    .map((teil) => {
      const [frage, ...rest] = teil.split('\n');
      return { frage: klartext(frage), antwort: klartext(rest.join('\n')) };
    })
    .filter((f) => f.frage && f.antwort);
}

/** FAQPage aus sichtbaren Fragen und Antworten (nur auszeichnen, was auf der Seite steht). */
export function faqSchema(url: string, fragen: Array<{ frage: string; antwort: string }>) {
  return {
    '@type': 'FAQPage',
    '@id': `${url}#faq`,
    mainEntity: fragen.map((f) => ({ '@type': 'Question', name: f.frage, acceptedAnswer: { '@type': 'Answer', text: f.antwort } })),
  };
}
