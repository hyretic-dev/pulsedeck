import type { APIRoute } from 'astro';
import { getCollection } from 'astro:content';
import { beitraege } from '../blog';
import { APP_URL, KONTAKT, SITE_URL } from '../config';

/**
 * llms.txt (https://llmstxt.org): kuratierte Übersicht für KI-Assistenten und Agenten. Ob Antwortmaschinen die Datei für Zitate
 * auswerten, ist nicht belegt; sie kostet nichts und hilft Werkzeugen, die Seiten gezielt zu lesen. Volltext: /llms-full.txt.
 */
export const GET: APIRoute = async () => {
  const kapitel = (await getCollection('handbook')).sort((a, b) => a.data.order - b.data.order);
  const posts = await beitraege();
  const zeilen = [
    '# PulseDeck',
    '',
    '> PulseDeck ist eine webbasierte Plattform für Vereine, Parteigliederungen, NGOs und Aktionsbündnisse im deutschsprachigen Raum: Termine mit Helferslots, Mitgliederverwaltung mit Rollen und Rechten, Arbeitsgruppen, Newsfeed mit Umfragen, E-Mail-Newsletter, Wiki, Dateiablage und ein optionaler KI-Assistent. Gehostet in der EU (Deutschland), Open Source (AGPLv3), im Early Access kostenlos.',
    '',
    `- Website: ${SITE_URL}/`,
    `- Anwendung (Anmeldung, Registrierung): ${APP_URL}/`,
    `- Kontakt: ${KONTAKT}`,
    '- Quellcode: https://github.com/julienstack/pulsedeck',
    '',
    '## Handbuch',
    '',
    ...kapitel.map((k) => `- [${k.data.title}](${SITE_URL}/handbuch/${k.id}): ${k.data.description}`),
    '',
    '## Blog',
    '',
    ...posts.map((b) => `- [${b.data.title}](${SITE_URL}/blog/${b.id}): ${b.data.description}`),
    '',
    '## Rechtliches',
    '',
    `- [Datenschutzerklärung](${SITE_URL}/datenschutz): Verantwortliche, Hosting in Deutschland, Auftragsverarbeitung für Organisationen`,
    `- [Impressum](${SITE_URL}/impressum)`,
    '',
    '## Optional',
    '',
    `- [Vollständiger Text von Handbuch und Blog](${SITE_URL}/llms-full.txt)`,
    '',
  ];
  return new Response(zeilen.join('\n'), { headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
};
