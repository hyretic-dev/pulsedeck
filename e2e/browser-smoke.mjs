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
/** E-Mail des Mitglieds, das später als zweite Person ein Konto bekommt (je Lauf eindeutig, sonst gäbe es das Konto schon). */
const mitgliedEmail = `neu-${stamp}@example.org`;

const probleme = [];
const ergebnisse = [];
let aktuell = 'Start';

const browser = await chromium.launch();
const kontext = await browser.newContext({ viewport: { width: 1400, height: 900 } });
const seite = await kontext.newPage();
/** Meldet Konsolen-, Seiten- und Netzwerkfehler einer Seite (auch für weitere Personen im selben Lauf). */
function ueberwache(s) {
  s.on('console', (m) => {
    // der Browser meldet auch absichtlich provozierte Antworten (z. B. 409 bei belegtem Ort) als Konsolenfehler
    if (erwartet.some((e) => m.text().includes(`status of ${e.status}`))) return;
    if (m.type() === 'error' && !m.text().includes('Failed to fetch')) probleme.push(`[${aktuell}] console: ${m.text().slice(0, 160)}`);
  });
  s.on('pageerror', (e) => probleme.push(`[${aktuell}] pageerror: ${e.message.slice(0, 160)}`));
  s.on('requestfailed', (r) => {
    const grund = r.failure()?.errorText ?? '';
    if (!grund.includes('ABORTED') && r.url().includes('/api/')) probleme.push(`[${aktuell}] requestfailed ${grund} ${r.method()} ${new URL(r.url()).pathname}`);
  });
  s.on('response', async (r) => {
    const u = new URL(r.url());
    if (u.pathname.startsWith('/api/') && r.status() >= 400) {
      let text = '';
      try { text = (await r.text()).slice(0, 140); } catch { /* ignorieren */ }
      // erwartete Ablehnungen einzelner Schritte tragen sie selbst ein (siehe `erwartet`)
      if (erwartet.some((e) => e.status === r.status() && u.pathname.includes(e.pfad))) return;
      probleme.push(`[${aktuell}] ${r.status()} ${r.request().method()} ${u.pathname} ${text}`);
    }
  });
}
/** Antworten, die ein Schritt absichtlich provoziert (z. B. 409 bei belegtem Ort) und nicht als Auffälligkeit zählen. */
let erwartet = [];
ueberwache(seite);

// nur das Ende des Logs: ein lange laufender Stack hat sonst mehr Zeilen, als der Puffer fasst
const logs = () => execSync(`${COMPOSE} logs --tail 4000 backend 2>&1`, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }).replace(/\x1b\[[0-9;]*m/g, '');
const logLink = (muster) => ((logs().split('\n').filter((l) => l.includes(muster)).pop() ?? '').match(/https?:\/\/\S+/) ?? [])[0];
const sichtbar = async (name, text) => {
  try {
    await seite.getByText(text).first().waitFor({ timeout: 6000 });
    ergebnisse.push(`ok     ${name}`);
  } catch {
    ergebnisse.push(`FEHLER ${name}: „${text}“ nicht sichtbar`);
  }
};
const sichtbar2 = async (s, text, name) => {
  try {
    await s.getByText(text).first().waitFor({ timeout: 6000 });
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
for (const pfad of ['', '/feed', '/wiki', '/calendar', '/belegung', '/gruppen', '/contacts', '/files', '/members', '/profile', '/settings', '/audit', '/roadmap']) {
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
await seite.getByPlaceholder('max@example.com').fill(mitgliedEmail);
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


// ── Belegung ────────────────────────────────────────────────────────────────────────────
const SHOTS = process.env.E2E_SHOTS;
const foto = async (s, name) => { if (SHOTS) await s.screenshot({ path: join(SHOTS, `${name}.png`) }); };
const knopf = (s, name) => s.locator('button.p-button:visible', { hasText: new RegExp(`^\\s*${name}\\s*$`) }).first();
const imDialog = (s, name) => s.locator('.p-dialog button:visible', { hasText: new RegExp(`^\\s*${name}\\s*$`) }).first();
/** Setzt ein Datum im PrimeNG-DatePicker durch Tippen und prüft, dass es übernommen wurde (nach dem Öffnen eines Dialogs braucht das einen Moment). */
async function setzeDatum(s, eingabe, text) {
  for (let versuch = 0; versuch < 5; versuch++) {
    await eingabe.click();
    await eingabe.press('Control+A');
    await eingabe.pressSequentially(text);
    await eingabe.press('Enter');
    await s.keyboard.press('Escape').catch(() => undefined);
    await s.waitForTimeout(250);
    if ((await eingabe.inputValue()) === text) return;
  }
  throw new Error(`Datum ${text} ließ sich im Dialog nicht setzen`);
}
const morgen = new Date(Date.now() + 86_400_000);
const morgenText = `${String(morgen.getDate()).padStart(2, '0')}.${String(morgen.getMonth() + 1).padStart(2, '0')}.${morgen.getFullYear()}`;

aktuell = 'Belegung: Plan';
await seite.goto(`${BASIS}/${slug}/dashboard/belegung`);
await sichtbar('Belegung: leerer Zustand mit Aktion „Plan anlegen“', 'Noch kein Belegungsplan');
await knopf(seite, 'Plan anlegen').click();
await seite.locator('#plan-name').fill('Bürgerhaus Saal');
await seite.locator('#plan-adresse').fill('Marktstraße 12, 50667 Köln');
await imDialog(seite, 'Anlegen').click();
await sichtbar('Belegung: Plan anlegen', 'Plan angelegt');
await seite.waitForSelector('app-booking-year-grid, app-booking-month-grid, app-booking-day-list');
await foto(seite, 'belegung-jahr');

aktuell = 'Belegung: Buchende benennen';
// zweite Person: das oben angelegte Mitglied „Neues Mitglied“ (neu@example.org) bekommt ein Konto über die Registrierung
await seite.locator('button[aria-label="Einstellungen des Belegungsplans"]').click();
await seite.locator('p-tab[value="personen"]').click();
await seite.locator('.p-dialog p-select', { hasText: 'Person wählen' }).first().click();
await seite.locator('.p-select-option', { hasText: 'Neues Mitglied' }).click();
await imDialog(seite, 'Hinzufügen').click();
await sichtbar('Belegung: Person als Buchende benannt', 'Neues Mitglied');
await imDialog(seite, 'Fertig').click();

aktuell = 'Belegung: zweite Person';
const beaKontext = await browser.newContext({ viewport: { width: 1400, height: 900 } });
const bea = await beaKontext.newPage();
ueberwache(bea);
await bea.goto(`${BASIS}/registrieren?ref=e2e-smoke`);
await bea.getByPlaceholder('Max Mustermann').fill('Neues Mitglied');
await bea.getByPlaceholder('max@example.de').fill(mitgliedEmail);
await bea.getByRole('button', { name: /Lieber ein Passwort festlegen/ }).click();
await bea.locator('p-password input').first().fill(passwort);
await bea.locator('p-password input').first().press('Tab');
await bea.getByRole('button', { name: /Weiter/ }).dispatchEvent('click');
await bea.getByPlaceholder('z.B. Verein Musterstadt e.V.').fill(`Beas Verein ${stamp}`);
await bea.getByPlaceholder('mein-verein').fill(`bea${stamp}`);
await bea.getByPlaceholder('mein-verein').blur();
await bea.waitForTimeout(500);
await bea.getByLabel('Wie seid ihr auf PulseDeck gekommen?').selectOption('workshop');
await bea.getByRole('button', { name: /Organisation erstellen/ }).click();
await bea.waitForTimeout(1500);
const beaLink = logLink(`Verifikation an ${mitgliedEmail}`);
if (!beaLink) throw new Error('Kein Bestätigungslink für die zweite Person im Backend-Log');
await bea.goto(beaLink);
await bea.waitForURL(`**/bea${stamp}/dashboard`, { timeout: 15000 });

aktuell = 'Belegung: anfragen';
await bea.goto(`${BASIS}/${slug}/dashboard/belegung`);
await bea.waitForSelector('app-booking-year-grid', { timeout: 15000 });
const beaText = await bea.locator('body').innerText();
ergebnisse.push(/Bürgerhaus Saal/.test(beaText) && !/Du kannst diesen Plan ansehen/.test(beaText) ? 'ok     Buchende sieht den Plan mit Rolle (kein „nur ansehen“-Hinweis)' : 'FEHLER Buchende sieht den Plan nicht mit Rolle');
await knopf(bea, 'Anfragen').click();
await setzeDatum(bea, bea.locator('.p-dialog p-datepicker input').first(), morgenText);
await bea.locator('#belegung-titel').fill('Kreismitgliederversammlung');
await bea.waitForTimeout(500);
await foto(bea, 'belegung-anfrage-dialog');
await imDialog(bea, 'Anfragen').click();
await sichtbar2(bea, 'Angefragt', 'Belegung: Buchende stellt eine Anfrage');

aktuell = 'Belegung: annehmen';
await seite.goto(`${BASIS}/${slug}/dashboard/belegung`);
await seite.waitForSelector('app-booking-year-grid, app-booking-month-grid, app-booking-day-list');
await seite.getByText(/^Anfragen \(1\)$/).click();
await sichtbar('Belegung: Anfrage im Eingang der Verwaltung', 'Kreismitgliederversammlung');
await foto(seite, 'belegung-eingang');
await knopf(seite, 'Annehmen').click();
await seite.locator('.p-confirmdialog button', { hasText: /^\s*Annehmen\s*$/ }).click();
await sichtbar('Belegung: Anfrage annehmen', 'Angenommen');
await bea.goto(`${BASIS}/${slug}/dashboard/belegung`);
await bea.waitForSelector('app-booking-year-grid, app-booking-month-grid, app-booking-day-list');
await bea.getByText('Meine Anfragen', { exact: true }).click();
await sichtbar2(bea, 'bestätigt', 'Belegung: Buchende sieht „bestätigt“');
await beaKontext.close();

aktuell = 'Belegung: Monat';
await seite.goto(`${BASIS}/${slug}/dashboard/belegung`);
await seite.waitForSelector('app-booking-year-grid, app-booking-month-grid, app-booking-day-list');
await seite.getByText('Monat', { exact: true }).first().click();
await seite.waitForTimeout(500);
await foto(seite, 'belegung-monat');

aktuell = 'Belegung: Termin mit Ort';
await seite.goto(`${BASIS}/${slug}/dashboard/calendar`);
await seite.waitForTimeout(1500);
await knopf(seite, 'Neu').click();
await seite.waitForTimeout(500);
await seite.getByPlaceholder('Vorstandssitzung').fill('Bündnistreffen mit Ort');
await setzeDatum(seite, seite.locator('.p-dialog p-datepicker input').first(), morgenText);
await seite.getByPlaceholder('19:00').fill('19:30');
await seite.getByPlaceholder('21:00').fill('21:15');
await seite.locator('.p-dialog p-select', { hasText: 'Auswählen' }).first().click();
await seite.locator('.p-select-option', { hasText: 'Vor Ort' }).click();
await seite.locator('#ort-reservieren').click();
await seite.locator('.p-select-option', { hasText: 'Bürgerhaus Saal' }).click();
await seite.waitForTimeout(500);
await foto(seite, 'belegung-termin-ort');
await imDialog(seite, 'Erstellen').click();
await sichtbar('Belegung: Termin mit Ort angelegt', 'Termin erstellt');
await seite.goto(`${BASIS}/${slug}/dashboard/calendar`);
await sichtbar('Belegung: Chip „bestätigt“ am Termin', 'bestätigt');
// derselbe Zeitraum nochmal: 409, nichts wird gespeichert
erwartet = [{ status: 409, pfad: '/events' }];
await knopf(seite, 'Neu').click();
await seite.waitForTimeout(500);
await seite.getByPlaceholder('Vorstandssitzung').fill('Doppelt');
await setzeDatum(seite, seite.locator('.p-dialog p-datepicker input').first(), morgenText);
await seite.getByPlaceholder('19:00').fill('20:00');
await seite.getByPlaceholder('21:00').fill('21:00');
await seite.locator('.p-dialog p-select', { hasText: 'Auswählen' }).first().click();
await seite.locator('.p-select-option', { hasText: 'Vor Ort' }).click();
await seite.locator('#ort-reservieren').click();
await seite.locator('.p-select-option', { hasText: 'Bürgerhaus Saal' }).click();
await imDialog(seite, 'Erstellen').click();
await sichtbar('Belegung: belegter Ort → Meldung, Dialog bleibt offen', 'schon belegt');
erwartet = [];
await foto(seite, 'belegung-termin-konflikt');
await imDialog(seite, 'Abbrechen').click();

aktuell = 'Belegung: öffentliche Seite';
await seite.goto(`${BASIS}/${slug}/dashboard/belegung`);
await seite.waitForSelector('app-booking-year-grid, app-booking-month-grid, app-booking-day-list');
await seite.locator('button[aria-label="Einstellungen des Belegungsplans"]').click();
await seite.locator('.p-dialog p-select', { hasText: 'Nicht öffentlich' }).first().click();
await seite.locator('.p-select-option', { hasText: 'Jahresansicht' }).click();
await imDialog(seite, 'Speichern').click();
await sichtbar('Belegung: Plan öffentlich geschaltet', 'Die Einstellungen gelten sofort');
const anonym = await browser.newContext({ viewport: { width: 1400, height: 900 } });
const oeffentlich = await anonym.newPage();
ueberwache(oeffentlich);
await oeffentlich.goto(`${BASIS}/${slug}`);
try {
  await oeffentlich.waitForSelector('app-public-booking section', { timeout: 15000 });
  const t = await oeffentlich.locator('app-public-booking').innerText();
  const knoepfe = (await oeffentlich.locator('app-public-booking button').allInnerTexts()).join('|');
  ergebnisse.push(/Bürgerhaus Saal/.test(t) && !/Anfragen|Eintragen|Reservieren/.test(knoepfe) ? 'ok     Öffentliche Seite zeigt den Plan ohne Buchungsknöpfe' : `FEHLER Öffentliche Seite zeigt Buchungsknöpfe oder keinen Plan (Knöpfe: ${knoepfe})`);
  await foto(oeffentlich, 'belegung-oeffentlich');
} catch {
  ergebnisse.push('FEHLER Öffentliche Seite zeigt keine Belegung');
}
await anonym.close();
for (const [breite, name] of [[390, 'mobil']]) {
  await seite.setViewportSize({ width: breite, height: 844 });
  await seite.goto(`${BASIS}/${slug}/dashboard/belegung`);
  await seite.waitForSelector('app-booking-year-grid, app-booking-month-grid, app-booking-day-list');
  await foto(seite, `belegung-${name}`);
}
await seite.setViewportSize({ width: 1400, height: 900 });


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
