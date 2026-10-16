// Schreibgeschützte Abnahme (READ_ONLY=true) mit der echten Oberfläche: Anmelden und Lesen müssen funktionieren, Schreiben liefert 503.
// Läuft gegen einen Compose-Stack, dessen Frontend mit READ_ONLY=true gestartet ist. Das Konto wird vorher per API angelegt
// (E2E_EMAIL / E2E_PASSWORD), weil Registrieren in dieser Betriebsart gesperrt ist.
//   E2E_BASE_URL=http://localhost:18099 E2E_EMAIL=… E2E_PASSWORD=… node readonly-login.mjs
import { chromium } from 'playwright';

const BASIS = process.env.E2E_BASE_URL ?? 'http://localhost:18099';
const email = process.env.E2E_EMAIL;
const passwort = process.env.E2E_PASSWORD;
if (!email || !passwort) { console.error('E2E_EMAIL und E2E_PASSWORD fehlen'); process.exit(2); }

const browser = await chromium.launch();
const seite = await (await browser.newContext({ viewport: { width: 1300, height: 900 } })).newPage();
const gesperrt = [];
const unerwartet = [];
seite.on('response', (r) => {
  const u = new URL(r.url());
  if (!u.pathname.startsWith('/api/')) return;
  if (r.status() === 503) gesperrt.push(`${r.request().method()} ${u.pathname}`);
  else if (r.status() >= 400 && !(r.status() === 401 && u.pathname.endsWith('/auth/me'))) unerwartet.push(`${r.status()} ${r.request().method()} ${u.pathname}`);
});

await seite.goto(`${BASIS}/login`);
await seite.getByPlaceholder('name@beispiel.de').fill(email);
await seite.getByRole('button', { name: /Weiter/ }).dispatchEvent('click');
await seite.locator('p-password input').first().waitFor({ timeout: 8000 }).catch(() => undefined);
const passwortSchritt = await seite.locator('p-password input').count();
let angemeldet = false;
if (passwortSchritt > 0) {
  await seite.locator('p-password input').first().fill(passwort);
  await seite.getByRole('button', { name: /^Anmelden$/ }).dispatchEvent('click');
  angemeldet = await seite.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 15000 }).then(() => true, () => false);
}
await seite.waitForTimeout(1500);
const text = await seite.locator('body').innerText();
const erg = [
  [passwortSchritt > 0, 'Passwort-Schritt erscheint (E-Mail-Prüfung nicht gesperrt)'],
  [angemeldet, 'Anmeldung führt von /login weg'],
  [!/vorübergehend schreibgeschützt/.test(text), 'keine Sperrmeldung auf der Seite'],
  [unerwartet.length === 0, `keine unerwarteten API-Fehler${unerwartet.length ? ': ' + [...new Set(unerwartet)].join(', ') : ''}`],
];
await browser.close();
for (const [ok, was] of erg) console.log(`${ok ? 'ok    ' : 'FEHLER'} ${was}`);
if (gesperrt.length) console.log(`Info: ${[...new Set(gesperrt)].length} Hintergrund-Schreibzugriffe wurden wie vorgesehen mit 503 abgewiesen (${[...new Set(gesperrt)].join(', ')})`);
process.exit(erg.every(([ok]) => ok) ? 0 : 1);
