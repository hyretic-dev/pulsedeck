// Meldet alle URLs der Sitemap per IndexNow an Bing, Yandex, Seznam, Naver u. a. (https://www.indexnow.org).
// Die ChatGPT-Suche greift auf den Bing-Index zurück; IndexNow beschleunigt dort die Aufnahme neuer und geänderter Seiten.
// Google nutzt IndexNow nicht; dort hilft die Sitemap in der Search Console.
//
// Nach einem Deploy ausführen (die Seiten müssen schon live sein):  node scripts/indexnow.mjs
// Optional: SITE_URL=https://pulsedeck.de, nur bestimmte Pfade: node scripts/indexnow.mjs /blog/neuer-beitrag /blog
// Der Schlüssel liegt öffentlich unter public/<schlüssel>.txt; das ist bei IndexNow so vorgesehen.
import { readdirSync } from 'node:fs';
import { join } from 'node:path';

const site = (process.env.SITE_URL || 'https://pulsedeck.de').replace(/\/+$/, '');
const schluesselDatei = readdirSync(join(import.meta.dirname, '..', 'public')).find((f) => /^[0-9a-f]{32}\.txt$/.test(f));
if (!schluesselDatei) throw new Error('Kein IndexNow-Schlüssel in public/ gefunden (Datei <32 Hex-Zeichen>.txt)');
const key = schluesselDatei.replace(/\.txt$/, '');

const pfade = process.argv.slice(2);
const urlList = pfade.length
  ? pfade.map((p) => site + (p === '/' ? '/' : p))
  : [...(await (await fetch(`${site}/sitemap.xml`)).text()).matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);

const antwort = await fetch('https://api.indexnow.org/indexnow', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json; charset=utf-8' },
  body: JSON.stringify({ host: new URL(site).host, key, keyLocation: `${site}/${schluesselDatei}`, urlList }),
});
console.log(`IndexNow: ${urlList.length} URLs gemeldet, Antwort ${antwort.status} ${antwort.statusText}`);
// 200/202 = angenommen; 403 = Schlüsseldatei nicht erreichbar; 422 = URLs passen nicht zum Host
if (antwort.status >= 300) process.exit(1);
