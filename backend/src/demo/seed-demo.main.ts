import { Pool } from 'pg';

import { DEMO_STANDARD_SLUG, seedeDemoOrtsverband } from './seed-demo-ortsverband';

/**
 * Legt die Demo-Organisation „Ortsverband Musterstadt“ an (Workshops, Gespräche). Aufruf im Backend-Container:
 *   node dist/demo/seed-demo.main.js --owner du@example.de [--slug demo-ortsverband] [--reset]
 * Das Konto muss existieren (normal registrieren und bestätigen); es wird Admin der Demo. Verbindung über DATABASE_URL.
 */
function wert(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main(): Promise<void> {
  const besitzerEmail = wert('--owner');
  if (!besitzerEmail || !process.env.DATABASE_URL) {
    console.error('Aufruf: DATABASE_URL=… node dist/demo/seed-demo.main.js --owner <E-Mail> [--slug demo-ortsverband] [--reset]');
    process.exit(2);
  }
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 2 });
  try {
    const ergebnis = await seedeDemoOrtsverband(pool, { besitzerEmail, slug: wert('--slug') ?? DEMO_STANDARD_SLUG, zuruecksetzen: process.argv.includes('--reset') });
    console.log(`Demo „${ergebnis.slug}“ angelegt: ${ergebnis.mitglieder} Mitglieder, ${ergebnis.arbeitsgruppen} Arbeitsgruppen, ${ergebnis.termine} Termine, ${ergebnis.schichten} Schichten, ${ergebnis.wikiSeiten} Wiki-Seiten`);
  } finally {
    await pool.end();
  }
}

main().catch((fehler: unknown) => {
  console.error(fehler instanceof Error ? fehler.message : String(fehler));
  process.exit(1);
});
