import rss from '@astrojs/rss';
import type { APIContext } from 'astro';
import { beitraege } from '../../blog';

export async function GET(context: APIContext) {
  return rss({
    title: 'PulseDeck Blog',
    description: 'Neuigkeiten, Praxis und Einblicke zu PulseDeck.',
    site: context.site!,
    customData: '<language>de-DE</language>',
    trailingSlash: false,
    items: (await beitraege()).map((b) => ({
      title: b.data.title,
      description: b.data.description,
      pubDate: b.data.date,
      link: `/blog/${b.id}`,
    })),
  });
}
