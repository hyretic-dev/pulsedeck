// Erzeugt die Vorschaubilder (1200×630) der Blogbeiträge unter public/og/blog/<slug>.png aus Titel und Schlagworten.
// Nur Beiträge ohne vorhandenes Bild; mit --alle werden alle neu erzeugt. Braucht Playwright mit Chromium:
//   npx -y playwright@1 install chromium   (einmalig)
//   node scripts/og-bilder.mjs [--alle]
// PLAYWRIGHT_MODULE kann auf eine vorhandene Installation zeigen (z. B. /opt/node-tools/node_modules/playwright/index.mjs).
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const wurzel = join(import.meta.dirname, '..');
const quelle = join(wurzel, 'src/content/blog');
const ziel = join(wurzel, 'public/og/blog');
const alle = process.argv.includes('--alle');

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const feld = (kopf, name) => /^\s*$/.test(kopf) ? undefined : new RegExp(`^${name}:\\s*"?(.*?)"?\\s*$`, 'm').exec(kopf)?.[1];

function html(titel, tags) {
  return `<!doctype html><html><head><meta charset="utf-8"><style>
body{margin:0;width:1200px;height:630px;background:#050505;font-family:'Inter','Helvetica Neue',Arial,sans-serif;color:#fff;overflow:hidden;position:relative}
.g1{position:absolute;width:700px;height:700px;border-radius:50%;background:radial-gradient(circle,rgba(255,0,0,.32),transparent 65%);left:-200px;top:-280px}
.g2{position:absolute;width:700px;height:700px;border-radius:50%;background:radial-gradient(circle,rgba(0,177,156,.22),transparent 65%);right:-220px;bottom:-320px}
.w{position:relative;padding:70px 90px;height:100%;box-sizing:border-box;display:flex;flex-direction:column;justify-content:space-between}
.k{display:flex;align-items:center;justify-content:space-between}
.logo{display:flex;align-items:center;gap:16px;font-size:32px;font-weight:800}
.mark{width:56px;height:56px;border-radius:14px;background:linear-gradient(135deg,#FF0000,#6F003C);display:flex;align-items:center;justify-content:center}
.blog{font-size:22px;color:#FF5050;font-weight:700;letter-spacing:3px;text-transform:uppercase}
h1{font-size:${titel.length > 70 ? 54 : titel.length > 50 ? 62 : 70}px;line-height:1.1;margin:0;font-weight:800;letter-spacing:-1.5px;max-width:1020px}
.f{display:flex;gap:12px;font-size:22px;color:#D1D5DB}
.f div{border:1px solid #333;border-radius:999px;padding:8px 18px;background:#141414}
</style></head><body><div class="g1"></div><div class="g2"></div><div class="w">
<div class="k"><div class="logo"><div class="mark"><svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c0-3.6 2.9-6 6.5-6s6.5 2.4 6.5 6"/><circle cx="17" cy="9" r="2.6"/><path d="M16.5 14.2c2.9.2 5 2.3 5 5.3"/></svg></div>PulseDeck</div><div class="blog">Blog</div></div>
<h1>${esc(titel)}</h1>
<div class="f">${tags.slice(0, 3).map((t) => `<div>${esc(t)}</div>`).join('')}</div>
</div></body></html>`;
}

const browser = await chromium.launch();
const seite = await browser.newPage({ viewport: { width: 1200, height: 630 } });
for (const datei of readdirSync(quelle).filter((f) => f.endsWith('.md'))) {
  const slug = datei.replace(/\.md$/, '');
  const pfad = join(ziel, `${slug}.png`);
  if (!alle && existsSync(pfad)) continue;
  const kopf = /^---\n([\s\S]*?)\n---/.exec(readFileSync(join(quelle, datei), 'utf8'))?.[1] ?? '';
  const titel = feld(kopf, 'title') ?? slug;
  const tags = JSON.parse((/^tags:\s*(\[.*\])\s*$/m.exec(kopf)?.[1] ?? '[]'));
  await seite.setContent(html(titel, tags));
  await seite.screenshot({ path: pfad });
  console.log(`erstellt: public/og/blog/${slug}.png`);
}
await browser.close();
