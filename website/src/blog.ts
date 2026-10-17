import { getCollection } from 'astro:content';

/** Veröffentlichte Beiträge, neueste zuerst (Entwürfe fehlen). */
export async function beitraege() {
  return (await getCollection('blog', ({ data }) => !data.draft)).sort((a, b) => b.data.date.valueOf() - a.data.date.valueOf());
}

export const datum = (d: Date) => d.toLocaleDateString('de-DE', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
