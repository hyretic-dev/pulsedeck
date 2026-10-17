// Nach dem Build: Jede gebaute HTML-Seite (außer 404) muss in sitemap.xml stehen, und jede URL der Sitemap muss es als Seite geben.
// Bricht mit Fehlercode ab, damit eine vergessene Seite im Build auffällt (CI und Docker).
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const dist = join(import.meta.dirname, '..', 'dist');
const html = [];
const sammle = (ordner) => {
  for (const name of readdirSync(ordner)) {
    const pfad = join(ordner, name);
    if (statSync(pfad).isDirectory()) sammle(pfad);
    else if (name.endsWith('.html') && !name.startsWith('google')) html.push(relative(dist, pfad));
  }
};
sammle(dist);

const seiten = new Set(
  html.filter((p) => p !== '404.html').map((p) => (p === 'index.html' ? '/' : '/' + p.replace(/\.html$/, '').replace(/\/index$/, '')))
);
const sitemap = readFileSync(join(dist, 'sitemap.xml'), 'utf8');
const urls = new Set([...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => new URL(m[1]).pathname.replace(/(.)\/$/, '$1')));

const fehlen = [...seiten].filter((p) => !urls.has(p));
const zuviel = [...urls].filter((p) => !seiten.has(p));
if (fehlen.length || zuviel.length) {
  if (fehlen.length) console.error(`Seiten fehlen in sitemap.xml (in src/seiten.ts eintragen): ${fehlen.join(', ')}`);
  if (zuviel.length) console.error(`sitemap.xml nennt Seiten, die es nicht gibt: ${zuviel.join(', ')}`);
  process.exit(1);
}
console.log(`sitemap.xml: ${urls.size} Seiten, vollständig`);
