import type { APIRoute } from 'astro';
import { getCollection } from 'astro:content';
import { beitraege } from '../blog';
import { APP_URL, KONTAKT, SITE_URL } from '../config';
import { FUNKTIONEN } from '../data/funktionen';
import { ZIELGRUPPEN } from '../data/zielgruppen';

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
    '> PulseDeck ist eine webbasierte Plattform für Vereine, Parteigliederungen, NGOs und Aktionsbündnisse im deutschsprachigen Raum: Termine mit Helferslots, Mitgliederverwaltung mit Rollen und Rechten, Arbeitsgruppen, Newsfeed mit Umfragen, E-Mail-Newsletter, Wiki, Dateiablage und ein optionaler KI-Assistent. Gehostet in der EU (Deutschland), Open Source (AGPLv3). Im Early Access alle Funktionen kostenlos und ohne Mitgliederlimit; wie es danach weitergeht, ist offen.',
    '',
    `- Website: ${SITE_URL}/`,
    `- Anwendung (Anmeldung, Registrierung): ${APP_URL}/`,
    `- Kontakt: ${KONTAKT}`,
    '- Quellcode: https://github.com/julienstack/pulsedeck',
    '',
    '## Produkt',
    '',
    `- [Funktionen](${SITE_URL}/funktionen): Überblick über alle Funktionen`,
    ...FUNKTIONEN.map((f) => `- [${f.name}](${SITE_URL}/funktionen/${f.slug}): ${f.kurz}`),
    `- [Kosten](${SITE_URL}/preise): im Early Access kostenlos, danach noch offen`,
    `- [Datenschutz & Sicherheit](${SITE_URL}/sicherheit): Hosting, Auftragsverarbeitung, Rechte, KI, Open Source`,
    `- [Häufige Fragen](${SITE_URL}/faq)`,
    '',
    '## Für wen',
    '',
    ...ZIELGRUPPEN.map((z) => `- [PulseDeck für ${z.name}](${SITE_URL}/${z.slug}): ${z.beschreibung}`),
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
