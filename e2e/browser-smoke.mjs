import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { chromium } from 'playwright';

const BASIS = process.env.E2E_BASE_URL ?? 'http://localhost:18095';
const COMPOSE = process.env.E2E_COMPOSE ?? 'docker compose -p pulsedeck-e2e';
const stamp = Date.now();
const email = `e2e-${stamp}@example.org`;
const passwort = 'e2e-sicheres-passwort';
const slug = `e2e${stamp}`;

const probleme = [];
const ergebnisse = [];
let aktuell = 'Start';

const browser = await chromium.launch();
const kontext = await browser.newContext({ viewport: { width: 1400, height: 900 } });
const seite = await kontext.newPage();
seite.on('console', (m) => {
  if (m.type() === 'error' && !m.text().includes('Failed to fetch')) probleme.push(`[${aktuell}] console: ${m.text().slice(0, 160)}`);
});
seite.on('pageerror', (e) => probleme.push(`[${aktuell}] pageerror: ${e.message.slice(0, 160)}`));
seite.on('requestfailed', (r) => {
  const grund = r.failure()?.errorText ?? '';
  if (!grund.includes('ABORTED') && r.url().includes('/api/')) probleme.push(`[${aktuell}] requestfailed ${grund} ${r.method()} ${new URL(r.url()).pathname}`);
});
seite.on('response', async (r) => {
  const u = new URL(r.url());
  if (u.pathname.startsWith('/api/') && r.status() >= 400) {
    let text = '';
    try { text = (await r.text()).slice(0, 140); } catch { /* ignorieren */ }
    probleme.push(`[${aktuell}] ${r.status()} ${r.request().method()} ${u.pathname} ${text}`);
  }
});

const logs = () => execSync(`${COMPOSE} logs backend 2>&1`, { encoding: 'utf8' }).replace(/\x1b\[[0-9;]*m/g, '');
const logLink = (muster) => ((logs().split('\n').filter((l) => l.includes(muster)).pop() ?? '').match(/https?:\/\/\S+/) ?? [])[0];
const sichtbar = async (name, text) => {
  try {
    await seite.getByText(text).first().waitFor({ timeout: 6000 });
    ergebnisse.push(`ok     ${name}`);
  } catch {
    ergebnisse.push(`FEHLER ${name}: „${text}“ nicht sichtbar`);
  }
};
const oeffne = async (pfad, knopf) => {
  await seite.goto(`${BASIS}/${slug}/dashboard/${pfad}`);
  await seite.waitForTimeout(1500);
  await seite.locator('button:visible', { hasText: new RegExp(`^\\s*${knopf}\\s*$`) }).first().click();
  await seite.waitForTimeout(600);
};
const dialogKnopf = (name) => seite.locator('.p-dialog button:visible', { hasText: new RegExp(`^\\s*${name}\\s*$`) }).first();

aktuell = 'Registrierung';
await seite.goto(`${BASIS}/registrieren?ref=e2e-smoke`);
await seite.getByPlaceholder('Max Mustermann').fill('E2E Tester');
await seite.getByPlaceholder('max@example.de').fill(email);
// Passwort ist optional (Standard: Magic Link); der Test legt eins fest, um später die Passwort-Anmeldung zu prüfen
await seite.getByRole('button', { name: /Lieber ein Passwort festlegen/ }).click();
await seite.locator('p-password input').first().fill(passwort);
await seite.locator('p-password input').first().press('Tab');
await seite.getByRole('button', { name: /Weiter/ }).dispatchEvent('click'); // das Passwort-Panel überdeckt den Knopf
await seite.getByPlaceholder('z.B. Verein Musterstadt e.V.').fill(`E2E Verein ${stamp}`);
await seite.getByPlaceholder('mein-verein').fill(slug);
await seite.getByPlaceholder('mein-verein').blur();
await seite.waitForTimeout(500);
await seite.getByLabel('Wie seid ihr auf PulseDeck gekommen?').selectOption('workshop'); // Pflichtangabe
await seite.getByLabel(/Wir möchten Pilot-Organisation werden/).check();
await seite.getByLabel('Wunschzeitraum für das Gespräch').fill('abends');
await seite.getByRole('button', { name: /Organisation erstellen/ }).click();
await sichtbar('Registrierung verlangt E-Mail-Bestätigung', 'Bitte bestätige damit deine E-Mail-Adresse');

aktuell = 'Bestätigung';
await seite.waitForTimeout(1500);
const bestaetigung = logLink(`Verifikation an ${email}`);
if (!bestaetigung) throw new Error('Kein Bestätigungslink im Backend-Log (Mail-Transport muss „log“ sein)');
await seite.goto(bestaetigung);
await seite.waitForURL(`**/${slug}/dashboard`, { timeout: 15000 });
ergebnisse.push(seite.url().includes('token=') ? 'FEHLER Token blieb in der URL' : 'ok     Bestätigung legt die Organisation an, Token nicht in der URL');

aktuell = 'Seiten';
for (const pfad of ['', '/feed', '/wiki', '/calendar', '/gruppen', '/contacts', '/files', '/members', '/profile', '/settings', '/audit', '/roadmap']) {
  aktuell = `Seite ${pfad || '/'}`;
  await seite.goto(`${BASIS}/${slug}/dashboard${pfad}`);
  await seite.waitForTimeout(1500);
  const text = await seite.locator('body').innerText();
  const auffaellig = text.match(/undefined|NaN|\[object Object\]|Invalid Date/g);
  ergebnisse.push(auffaellig ? `FEHLER Seite ${pfad || '/'} zeigt ${[...new Set(auffaellig)].join(', ')}` : `ok     Seite ${pfad || '/'}`);
}

aktuell = 'Kontakt';
await oeffne('contacts', 'Neu');
await seite.getByPlaceholder('Max Mustermann').fill('Maria Beispiel');
await seite.getByPlaceholder('Vorsitzender').fill('Vorsitzende');
await seite.getByPlaceholder('Berlin').fill('Köln');
await seite.getByPlaceholder('Zuständigkeiten...').fill('Alles');
await seite.getByPlaceholder('max@example.com').fill('maria@example.org');
await dialogKnopf('Erstellen').click();
await sichtbar('Kontakt anlegen', 'Maria Beispiel');

aktuell = 'Termin';
await oeffne('calendar', 'Neu');
await seite.getByPlaceholder('Vorstandssitzung').fill('Sommerfest E2E');
await seite.getByPlaceholder('Ort / Link eingeben').fill('Stadtpark');
await dialogKnopf('Erstellen').click();
await sichtbar('Termin anlegen', 'Sommerfest E2E');

aktuell = 'Beitrag';
await oeffne('feed', 'Neuer Beitrag');
await seite.getByPlaceholder('Titel des Beitrags').fill('Beitrag E2E');
await seite.locator('.ql-editor:visible').first().fill('Hallo Welt');
await dialogKnopf('Speichern').click();
await seite.waitForTimeout(1000);
await seite.getByText('Meine Beiträge').first().click();
await sichtbar('Beitrag anlegen (Entwurf unter „Meine Beiträge“)', 'Beitrag E2E');

aktuell = 'Arbeitsgruppe';
await oeffne('gruppen', 'Neue AG');
await seite.getByPlaceholder('z.B. Öffentlichkeitsarbeit').fill('AG E2E');
await seite.getByPlaceholder('Zielsetzung...').fill('Testen');
await seite.locator('input[placeholder=Name]').fill('Leitung Test');
await dialogKnopf('Erstellen').click();
await sichtbar('AG anlegen', 'AG E2E');

aktuell = 'Wiki';
await oeffne('wiki', 'Neuen Artikel erstellen');
await seite.getByPlaceholder('Artikeltitel').fill('Wiki E2E');
await seite.getByPlaceholder('Kurzbeschreibung').fill('Beschreibung');
await seite.locator('.ql-editor:visible').first().fill('Inhalt');
await dialogKnopf('Erstellen').click();
await sichtbar('Wiki-Artikel anlegen', 'Artikel erstellt');

aktuell = 'Mitglied';
await oeffne('members', 'Neu');
await seite.getByPlaceholder('Max Mustermann').fill('Neues Mitglied');
await seite.getByPlaceholder('max@example.com').fill('neu@example.org');
await dialogKnopf('Erstellen').click();
await sichtbar('Mitglied anlegen', 'Neues Mitglied');

aktuell = 'Datei';
const datei = join(tmpdir(), 'e2e-datei.txt');
writeFileSync(datei, 'Inhalt der E2E-Datei, lang genug.');
await seite.goto(`${BASIS}/${slug}/dashboard/files`);
await seite.waitForTimeout(1500);
await seite.locator('button:visible', { hasText: /^\s*Hochladen\s*$/ }).first().click();
await seite.waitForTimeout(600);
await seite.locator('input[type=file]').setInputFiles(datei);
await seite.waitForTimeout(400);
await dialogKnopf('Hochladen').click();
await sichtbar('Datei hochladen', 'e2e-datei.txt');

aktuell = 'Datenexport';
await seite.goto(`${BASIS}/${slug}/dashboard/profile`);
await seite.waitForTimeout(1500);
try {
  const [download] = await Promise.all([
    seite.waitForEvent('download', { timeout: 10000 }),
    seite.locator('button:visible', { hasText: /^\s*Herunterladen\s*$/ }).first().click(),
  ]);
  const inhalt = JSON.parse(readFileSync(await download.path(), 'utf8'));
  ergebnisse.push(inhalt.account?.email === email && !JSON.stringify(inhalt).includes('password_hash') ? 'ok     Datenexport im Profil' : 'FEHLER Datenexport: Inhalt unerwartet');
} catch (e) {
  ergebnisse.push(`FEHLER Datenexport: ${String(e).slice(0, 120)}`);
}

aktuell = 'Sicherheits-Header';
const kopf = (await seite.request.get(`${BASIS}/`)).headers()['content-security-policy'] ?? '';
ergebnisse.push(kopf.includes("script-src 'self'") ? 'ok     CSP gesetzt (Verstöße erscheinen als Konsolenfehler)' : 'FEHLER CSP fehlt');

aktuell = 'Anmeldung';
await seite.evaluate(() => localStorage.clear());
await seite.goto(`${BASIS}/login`);
await seite.getByPlaceholder('name@beispiel.de').fill(email);
await seite.getByRole('button', { name: /Weiter/ }).dispatchEvent('click');
await seite.locator('p-password input').first().fill(passwort);
await seite.getByRole('button', { name: /^Anmelden$/ }).dispatchEvent('click');
try {
  await seite.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 15000 });
  ergebnisse.push('ok     Anmeldung mit Passwort');
} catch {
  ergebnisse.push('FEHLER Anmeldung mit Passwort');
}

await browser.close();
console.log(ergebnisse.join('\n'));
const einzigartig = [...new Set(probleme)];
console.log(einzigartig.length ? `\nAuffälligkeiten:\n${einzigartig.join('\n')}` : '\nKeine Auffälligkeiten');
process.exit(ergebnisse.some((z) => z.startsWith('FEHLER')) || einzigartig.length ? 1 : 0);
