import type { APIRoute } from 'astro';
import { getCollection } from 'astro:content';
import { beitraege } from '../blog';
import { SITE_URL } from '../config';

/** Volltext von Handbuch und Blog als Markdown in einer Datei, für KI-Werkzeuge (siehe llms.txt). */
export const GET: APIRoute = async () => {
  const kapitel = (await getCollection('handbook')).sort((a, b) => a.data.order - b.data.order);
  const posts = await beitraege();
  const teile = [
    '# PulseDeck - Handbuch und Blog (Volltext)',
    '',
    `Quelle: ${SITE_URL}/ · Stand: ${new Date().toISOString().split('T')[0]}`,
    '',
    ...kapitel.map((k) => `## Handbuch: ${k.data.title}\n\nURL: ${SITE_URL}/handbuch/${k.id}\n\n${(k.body ?? '').trim()}\n`),
    ...posts.map(
      (b) =>
        `## Blog: ${b.data.title}\n\nURL: ${SITE_URL}/blog/${b.id} · veröffentlicht ${b.data.date.toISOString().split('T')[0]}\n\n${(b.body ?? '').trim()}\n` +
        (b.data.faq.length ? `\n### Häufige Fragen\n\n${b.data.faq.map((f) => `**${f.frage}**\n${f.antwort}`).join('\n\n')}\n` : '')
    ),
  ];
  return new Response(teile.join('\n'), { headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
};
