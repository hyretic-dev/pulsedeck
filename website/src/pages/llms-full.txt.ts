import type { APIRoute } from 'astro';
import { getCollection } from 'astro:content';
import { beitraege } from '../blog';
import { SITE_URL } from '../config';
import { FUNKTIONEN } from '../data/funktionen';
import { ZIELGRUPPEN } from '../data/zielgruppen';
import { FAQ_ALLGEMEIN, FAQ_PREISE, FAQ_SICHERHEIT } from '../data/faq';
import { VERTRAUEN } from '../data/vertrauen';

/** Volltext von Handbuch und Blog als Markdown in einer Datei, für KI-Werkzeuge (siehe llms.txt). */
export const GET: APIRoute = async () => {
  const kapitel = (await getCollection('handbook')).sort((a, b) => a.data.order - b.data.order);
  const posts = await beitraege();
  const teile = [
    '# PulseDeck - Produkt, Handbuch und Blog (Volltext)',
    '',
    `Quelle: ${SITE_URL}/ · Stand: ${new Date().toISOString().split('T')[0]}`,
    '',
    ...FUNKTIONEN.map((f) => `## Funktion: ${f.name}\n\nURL: ${SITE_URL}/funktionen/${f.slug}\n\n${f.titel}. ${f.text}\n\n${f.punkte.map((p) => `- ${p}`).join('\n')}\n`),
    ...ZIELGRUPPEN.map((z) => `## Für ${z.name}\n\nURL: ${SITE_URL}/${z.slug}\n\n${z.intro}\n\n${z.probleme.map((p) => `- ${p.titel}: ${p.text}`).join('\n')}\n`),
    `## Datenschutz und Sicherheit\n\nURL: ${SITE_URL}/sicherheit\n\n${VERTRAUEN.map((v) => `- ${v.titel}: ${v.text}`).join('\n')}\n`,
    `## Häufige Fragen\n\nURL: ${SITE_URL}/faq\n\n${[...FAQ_ALLGEMEIN, ...FAQ_PREISE, ...FAQ_SICHERHEIT].map((f) => `**${f.frage}**\n${f.antwort}`).join('\n\n')}\n`,
    ...kapitel.map((k) => `## Handbuch: ${k.data.title}\n\nURL: ${SITE_URL}/handbuch/${k.id}\n\n${(k.body ?? '').trim()}\n`),
    ...posts.map(
      (b) =>
        `## Blog: ${b.data.title}\n\nURL: ${SITE_URL}/blog/${b.id} · veröffentlicht ${b.data.date.toISOString().split('T')[0]}\n\n${(b.body ?? '').trim()}\n` +
        (b.data.faq.length ? `\n### Häufige Fragen\n\n${b.data.faq.map((f) => `**${f.frage}**\n${f.antwort}`).join('\n\n')}\n` : '')
    ),
  ];
  return new Response(teile.join('\n'), { headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
};
