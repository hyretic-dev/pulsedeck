import { resolve } from 'node:path';
import { parseArgs } from 'node:util';

import { BcryptPasswordHasher } from '../auth/password-hasher';
import { SecretBox } from '../common/secret-box';
import { leseSchluessel } from '../config/configuration';
import { EXIT_CODES, MigrationError } from './errors';
import { exportiere } from './exporter';
import { importiere } from './importer';
import { validiere } from './validator';

const HILFE = `PulseDeck-Migration (Supabase → NestJS/PostgreSQL)

  node dist/migration/cli.js export   --out <verzeichnis> [--storage-dir <verzeichnis>] [--allow-missing-objects] [--allow-unmapped <tabelle>]...
                                      [--only-org <slug> [--keep-account <uuid>]...]
  node dist/migration/cli.js import   --from <exportverzeichnis> [--dry-run] [--platform-admin <uuid>]... [--newsletter-org <uuid>] [--show-details]
  node dist/migration/cli.js validate --from <exportverzeichnis>

Verbindungen nur über die Umgebung (nie als Argument, nie im Log):
  LEGACY_DATABASE_URL        export: lesender Zugang zur Supabase-Datenbank
  MIGRATIONS_DATABASE_URL    import/validate: Migrations-Rolle der Zieldatenbank
  FILES_DIR                  import/validate: Datei-Volume des Backends (Standard /data/files)
  SECRETS_ENCRYPTION_KEY     import: verschlüsselt das SMTP-Passwort der Newsletter-Konfiguration
`;

function pflicht(name: string): string {
  const wert = process.env[name];
  if (!wert) throw new MigrationError('USAGE', `Umgebungsvariable ${name} fehlt`);
  return wert;
}

/** Verbindungsdaten ohne Passwort für die Ausgabe. */
function ziel(url: string): string {
  try {
    const u = new URL(url);
    return `${u.hostname}${u.port ? `:${u.port}` : ''}${u.pathname}`;
  } catch {
    return '(ungültige URL)';
  }
}

async function main(): Promise<void> {
  const [befehl, ...rest] = process.argv.slice(2);
  const { values } = parseArgs({
    args: rest,
    options: {
      out: { type: 'string' },
      from: { type: 'string' },
      'storage-dir': { type: 'string' },
      'allow-missing-objects': { type: 'boolean' },
      'allow-unmapped': { type: 'string', multiple: true },
      'only-org': { type: 'string' },
      'keep-account': { type: 'string', multiple: true },
      'dry-run': { type: 'boolean' },
      'platform-admin': { type: 'string', multiple: true },
      'newsletter-org': { type: 'string' },
      'show-details': { type: 'boolean' },
    },
    strict: true,
  });
  const log = (zeile: string): void => console.log(zeile);

  if (befehl === 'export') {
    if (!values.out) throw new MigrationError('USAGE', '--out fehlt');
    const url = pflicht('LEGACY_DATABASE_URL');
    log(`Export aus ${ziel(url)} nach ${resolve(values.out)}`);
    const manifest = await exportiere({ sourceUrl: url, outDir: resolve(values.out), storageDir: values['storage-dir'] ? resolve(values['storage-dir']) : undefined, allowMissingObjects: values['allow-missing-objects'], allowUnmapped: values['allow-unmapped'], onlyOrg: values['only-org'], keepAccounts: values['keep-account'], log });
    log(`Export abgeschlossen: ${manifest.tables.length} Tabellen${manifest.storage.included ? `, ${manifest.storage.objects.length} Dateien` : ', ohne Dateiinhalte'}`);
  } else if (befehl === 'import') {
    if (!values.from) throw new MigrationError('USAGE', '--from fehlt');
    const url = pflicht('MIGRATIONS_DATABASE_URL');
    const fehler: string[] = [];
    const schluessel = leseSchluessel(process.env, fehler);
    if (fehler.length > 0) throw new MigrationError('MISSING_SECRET', fehler.join('; '));
    log(`${values['dry-run'] ? 'Probelauf' : 'Import'} nach ${ziel(url)}`);
    const bericht = await importiere({
      exportDir: resolve(values.from),
      targetUrl: url,
      filesDir: resolve(process.env.FILES_DIR ?? '/data/files'),
      secretBox: new SecretBox(schluessel),
      hasher: new BcryptPasswordHasher(),
      dryRun: values['dry-run'],
      platformAdminIds: values['platform-admin'],
      newsletterOrgId: values['newsletter-org'],
      showDetails: values['show-details'],
      log,
    });
    for (const [was, n] of Object.entries(bericht.transformations)) log(`Umwandlung: ${was}: ${n}`);
    log(bericht.status === 'dry-run-ok' ? 'Probelauf erfolgreich (nichts geschrieben)' : `Import abgeschlossen (${bericht.storage.copied} Dateien kopiert, ${bericht.storage.alreadyPresent} vorhanden)`);
  } else if (befehl === 'validate') {
    if (!values.from) throw new MigrationError('USAGE', '--from fehlt');
    const bericht = await validiere({ exportDir: resolve(values.from), targetUrl: pflicht('MIGRATIONS_DATABASE_URL'), filesDir: resolve(process.env.FILES_DIR ?? '/data/files'), log });
    if (!bericht.ok) throw new MigrationError('VALIDATION_FAILED', `${bericht.pruefungen.filter((p) => !p.ok).length} Prüfungen fehlgeschlagen`);
    log('Validierung erfolgreich');
  } else {
    console.log(HILFE);
    process.exitCode = befehl ? EXIT_CODES.USAGE : 0;
  }
}

main().catch((fehler: unknown) => {
  const f = fehler instanceof MigrationError ? fehler : new MigrationError(/ERR_PARSE_ARGS|Unknown option|argument/i.test((fehler as Error).message) ? 'USAGE' : 'UNEXPECTED', (fehler as Error).message);
  console.error(`FEHLER ${f.code}: ${f.message}`);
  process.exitCode = EXIT_CODES[f.code];
});
