// Paritätsabgleich: Was gibt es in Produktion, das unser Nachbau (Registry, Realtime, Scheduler, Migrationen) nicht kennt?
// Liest das Inventar eines Abzugs (capture.sh) und vergleicht es mit
//   - der Tabellen-Registry des Migrationswerkzeugs (backend/dist/migration/tables.js),
//   - der Realtime-Tabellenliste des Backends (backend/dist/realtime/realtime.service.js),
//   - dem Juni-Dump, aus dem das Replay besteht (backend/scripts/legacy-replay/01-live-dump.sql),
//   - dem eingefrorenen Stand des früheren Verzeichnisses supabase/ (scripts/prod-mirror/legacy-repo.json: Migrationen, Edge Functions).
// Voraussetzung: cd backend && npm run build.   Aufruf: node scripts/prod-mirror/parity.mjs [abzug-verzeichnis]
// Exit 0 = nichts Unbekanntes, 1 = Abweichungen (der Bericht steht auch in <abzug>/parity-report.md).
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HIER = dirname(fileURLToPath(import.meta.url));
const REPO = join(HIER, '..', '..');
const dir = process.argv[2] ?? (existsSync(join(REPO, 'backups/.latest')) ? readFileSync(join(REPO, 'backups/.latest'), 'utf8').trim() : '');
if (!dir || !existsSync(join(dir, 'inventory'))) {
  console.error('Abzug-Verzeichnis mit inventory/ fehlt (Aufruf: node scripts/prod-mirror/parity.mjs <abzug>)');
  process.exit(2);
}
const require = createRequire(import.meta.url);
let tables, realtime;
try {
  tables = require(join(REPO, 'backend/dist/migration/tables.js'));
  realtime = require(join(REPO, 'backend/dist/realtime/realtime.service.js'));
} catch {
  console.error('backend/dist fehlt – zuerst: cd backend && npm run build');
  process.exit(2);
}

const tsv = (name) => {
  const p = join(dir, 'inventory', name);
  return existsSync(p) ? readFileSync(p, 'utf8').split('\n').filter(Boolean).map((z) => z.split('\t')) : null;
};
const bericht = [];
let abweichungen = 0;
const abschnitt = (titel, zeilen, ok = zeilen.length === 0) => {
  bericht.push(`## ${titel}\n`);
  if (zeilen.length === 0) bericht.push(ok ? '_nichts zu berichten_\n' : '');
  else bericht.push(zeilen.map((z) => `- ${z}`).join('\n') + '\n');
  if (!ok) abweichungen += 1;
};
const hinweis = (titel, text) => {
  bericht.push(`## ${titel}\n\n${text}\n`);
};

const server = Object.fromEntries((tsv('server.tsv') ?? []).map(([k, v]) => [k, v]));
hinweis('Quelle', `PostgreSQL ${server.version ?? '?'}, Datenbank ${server.database ?? '?'}, Rolle ${server.role ?? '?'}, Größe ${server.size_bytes ? `${(Number(server.size_bytes) / 1048576).toFixed(1)} MB` : '?'}\n\nErweiterungen: ${(tsv('extensions.tsv') ?? []).map((e) => `${e[0]} ${e[1]}`).join(', ') || '–'}`);

// 1. Tabellen
const juni = readFileSync(join(REPO, 'backend/scripts/legacy-replay/01-live-dump.sql'), 'utf8');
const imJuni = (re) => new Set([...juni.matchAll(re)].map((m) => m[1]));
const bekannt = new Set([...tables.TABLES.map((t) => t.table), ...Object.keys(tables.NICHT_UEBERNOMMEN)]);
const prodTabellen = (tsv('tables.tsv') ?? []).filter((r) => r[0] === 'public' && ['r', 'p'].includes(r[2])).map((r) => r[1]);
abschnitt('Tabellen in `public` ohne Zuordnung in der Registry (würden beim Export abbrechen)', prodTabellen.filter((t) => !bekannt.has(t)).map((t) => `\`${t}\` (≈ ${(tsv('tables.tsv') ?? []).find((r) => r[0] === 'public' && r[1] === t)?.[3]} Zeilen)`));
abschnitt('Registry-Tabellen, die es in Produktion nicht gibt (optional markierte ausgenommen)', tables.TABLES.filter((t) => !t.optional && t.source === undefined && !prodTabellen.includes(t.table)).map((t) => `\`${t.table}\``));
const tabellenJuni = imJuni(/CREATE TABLE (?:IF NOT EXISTS )?"?public"?\."?(\w+)"?/g);
abschnitt('Tabellen seit dem Juni-Dump neu (Dashboard-Änderungen; Spalten gegen das Zielschema prüft der Import)', prodTabellen.filter((t) => !tabellenJuni.has(t)).map((t) => `\`${t}\``), true);

// 2. Realtime
// Nur Tabellen aus `public` zählen; die Publication `supabase_realtime_messages_publication` gehört der Plattform (realtime.messages_*)
const pubs = (tsv('publications.tsv') ?? []).filter((p) => !p[5] || p[5].startsWith('public.'));
const pubTabellen = [...new Set(pubs.filter((p) => p[5]).map((p) => p[5].replace(/^public\./, '')))];
const erlaubt = new Set(realtime.REALTIME_TABELLEN);
abschnitt('Realtime-Publication: Tabellen, die das Backend nicht als Impulsquelle anbietet', pubTabellen.filter((t) => !erlaubt.has(t)).map((t) => `\`${t}\``));
hinweis('Realtime-Publications', pubs.length ? [...new Set(pubs.map((p) => `\`${p[0]}\` (${p[1] === 't' ? 'alle Tabellen' : `${pubs.filter((x) => x[0] === p[0] && x[5]).length} Tabellen`}, insert/update/delete = ${p[2]}/${p[3]}/${p[4]})`))].join('\n') : 'keine');

// 3. Trigger und Funktionen
// Trigger der Plattform (storage.*, realtime.*) sind kein Teil der Anwendung
const trigger = (tsv('triggers.tsv') ?? []).filter((t) => /^(public|auth)\./.test(t[0]));
const ERSETZT = { on_auth_user_link_members: 'ersetzt durch die Verknüpfung per bestätigter E-Mail (E23, member-linking)' };
const triggerJuni = imJuni(/CREATE (?:OR REPLACE )?TRIGGER "?(\w+)"?/g);
abschnitt('Trigger in Produktion, die der Juni-Dump nicht kennt (z. B. auf auth.users oder Datenbank-Webhooks)', trigger.filter((t) => !triggerJuni.has(t[1]) && !ERSETZT[t[1]]).map((t) => `${t[0]}: \`${t[1]}\` — ${t[2]}`));
if (trigger.some((t) => ERSETZT[t[1]])) hinweis('Bekannte, ersetzte Trigger', trigger.filter((t) => ERSETZT[t[1]]).map((t) => `- ${t[0]}: \`${t[1]}\` — ${ERSETZT[t[1]]}`).join('\n'));
abschnitt('Trigger aus dem Juni-Dump, die es in Produktion nicht mehr gibt', [...triggerJuni].filter((n) => !trigger.some((t) => t[1] === n)).map((n) => `\`${n}\``), true);
const funktionen = (tsv('functions.tsv') ?? []).filter((f) => f[0] === 'public');
const funktionenJuni = imJuni(/CREATE (?:OR REPLACE )?FUNCTION "?public"?\."?(\w+)"?/g);
abschnitt('Funktionen in `public`, die der Juni-Dump nicht kennt', funktionen.filter((f) => !funktionenJuni.has(f[1])).map((f) => `\`${f[1]}(${f[3]})\``));

// 4. Zeitpläne
const cron = tsv('cron.tsv');
abschnitt('pg_cron-Jobs (Ersatz: Scheduler, E29; bekannt ist nur `ingest-docs`)', cron ? cron.map((j) => `Job ${j[0]} \`${j[1] || '(ohne Name)'}\` ${j[2]} aktiv=${j[3]} — ${j[4]}`) : [], cron === null || cron.every((j) => /ingest/i.test(`${j[1]} ${j[4]}`)));

// 5. Storage und Auth
const buckets = tsv('buckets.tsv') ?? [];
abschnitt('Buckets außer `files` mit Inhalt (die Anwendung greift nur auf `files` zu; Inhalte anderer Buckets wären nicht migriert)', buckets.filter((b) => b[0] !== 'files' && Number(b[4]) > 0).map((b) => `\`${b[0]}\` public=${b[1]} Objekte=${b[4]} Bytes=${b[5]}`));
if (buckets.some((b) => b[0] !== 'files' && Number(b[4]) === 0)) hinweis('Leere Buckets', buckets.filter((b) => b[0] !== 'files' && Number(b[4]) === 0).map((b) => `- \`${b[0]}\` (öffentlich=${b[1]}, 0 Objekte)`).join('\n'));
if (buckets.find((b) => b[0] === 'files')) {
  const f = buckets.find((b) => b[0] === 'files');
  hinweis('Bucket `files`', `${f[4]} Objekte, ${(Number(f[5]) / 1048576).toFixed(1)} MB, öffentlich=${f[1]}, Größenlimit=${f[2] || '–'}, MIME-Filter=${f[3] || '–'}`);
}
const hashes = tsv('hash-formats.tsv') ?? [];
abschnitt('Passwort-Hash-Formate außer bcrypt ($2a/$2b/$2y) — diese Konten könnten sich nicht anmelden', hashes.filter((h) => !/^\$2[aby]\$/.test(h[0])).map((h) => `\`${h[0]}…\` × ${h[1]}`));
hinweis('Konten und Anbieter', `${(tsv('auth.tsv') ?? []).map((a) => `${a[0]}=${a[1]}`).join(', ') || '–'}\n\nHash-Formate: ${hashes.map((h) => `${h[0]}×${h[1]}`).join(', ') || '–'}\n\nIdentitäten: ${(tsv('identities.tsv') ?? []).map((i) => `${i[0]}×${i[1]}`).join(', ') || '–'}  (nur \`email\` ist ohne OAuth-Umsetzung vollständig abgedeckt, O5)`);

// 6. Migrationsstand
const prodVersionen = new Set((tsv('migrations.tsv') ?? []).map((m) => m[0]));
const altRepo = JSON.parse(readFileSync(join(HIER, 'legacy-repo.json'), 'utf8'));
const repoVersionen = new Set(altRepo.migrations);
if (prodVersionen.size > 0) {
  abschnitt('In Produktion angewandte Migrationen, die im Repo fehlen (Änderungen außerhalb des Repos)', [...prodVersionen].filter((v) => !repoVersionen.has(v)).map((v) => `\`${v}\``));
  abschnitt('Migrationen des früheren Repos, die in Produktion nie angewandt wurden', [...repoVersionen].filter((v) => !prodVersionen.has(v)).map((v) => `\`${v}\``), true);
}

// 6b. Edge Functions (bereitgestellt laut edge-functions.tsv bzw. config/functions.json)
let bereitgestellt = null;
const efDatei = join(dir, 'edge-functions.tsv');
if (existsSync(efDatei)) bereitgestellt = readFileSync(efDatei, 'utf8').split('\n').filter(Boolean).map((z) => z.split('\t')[0]);
else if (existsSync(join(dir, 'config', 'functions.json'))) bereitgestellt = JSON.parse(readFileSync(join(dir, 'config', 'functions.json'), 'utf8')).map((f) => f.slug);
if (bereitgestellt) {
  const imRepo = altRepo.edgeFunctions;
  abschnitt('In Produktion bereitgestellte Edge Functions, die es im Repo nicht gibt (unbekannter, ungeprüfter Code mit Service-Rolle)', bereitgestellt.filter((f) => !imRepo.includes(f)).map((f) => `\`${f}\``));
  abschnitt('Edge Functions im Repo, die in Produktion nie bereitgestellt waren (Funktion war dort nie aktiv)', imRepo.filter((f) => !bereitgestellt.includes(f)).map((f) => `\`${f}\``), true);
}

// 7. Konfiguration außerhalb der Datenbank
const konfig = join(dir, 'config');
const dateien = existsSync(konfig) ? readdirSync(konfig) : [];
hinweis('Konfiguration (Management-API)', dateien.length ? dateien.map((d) => `- \`${d}\``).join('\n') + '\n\nAuth-Einstellungen (Provider, „Confirm email“, Redirect-URLs, Mailvorlagen), Edge-Function-Liste mit `verify_jwt` und Secret-Namen **von Hand** gegen E19, O4, O5, E29/E30 halten.' : 'nicht abgerufen (SUPABASE_ACCESS_TOKEN/SUPABASE_PROJECT_REF fehlten oder die API lieferte keine Daten)');

const text = `# Paritätsbericht\n\nAbzug: \`${dir}\`\n\n${bericht.join('\n')}\n${abweichungen === 0 ? '**Keine Abweichungen.**' : `**${abweichungen} Abschnitt(e) mit Abweichungen – vor dem Cutover klären.**`}\n`;
writeFileSync(join(dir, 'parity-report.md'), text, { mode: 0o600 });
console.log(text);
process.exit(abweichungen === 0 ? 0 : 1);
