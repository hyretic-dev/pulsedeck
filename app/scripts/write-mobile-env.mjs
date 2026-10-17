// Erzeugt src/environments/environment.capacitor.ts für den Build der nativen Apps (Capacitor).
// Die App lädt ihre Oberfläche vom eigenen Ursprung (https://localhost bzw. capacitor://localhost) und braucht deshalb eine
// absolute Adresse der API. Das Backend muss diesen Ursprung in CORS_ORIGINS freigeben.
//
//   PULSEDECK_API_URL=https://app.example.org npm run build:mobile
// Optional: PULSEDECK_WEBSITE_URL = Adresse der Website für Impressum, Datenschutz und Handbuch (Standard: https://pulsedeck.de).
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

const url = process.env.PULSEDECK_API_URL ?? '';
let basis;
try {
  const u = new URL(url);
  if (u.protocol !== 'https:' || u.pathname !== '/' || u.search || u.hash) throw new Error('Format');
  basis = u.origin;
} catch {
  console.error('PULSEDECK_API_URL fehlt oder ist ungültig: erwartet wird der https-Ursprung der Instanz ohne Pfad, z. B. https://app.example.org');
  process.exit(1);
}

const webseite = (process.env.PULSEDECK_WEBSITE_URL ?? 'https://pulsedeck.de').replace(/\/+$/, '');

writeFileSync(
  join(import.meta.dirname, '..', 'src', 'environments', 'environment.capacitor.ts'),
  `// Erzeugt von scripts/write-mobile-env.mjs, nicht einchecken.
export const environment = {
    production: true,
    apiBaseUrl: '${basis}/api/v1',
    websiteUrl: '${webseite}',
};
`
);
console.log(`API-Basis der nativen App: ${basis}/api/v1`);
