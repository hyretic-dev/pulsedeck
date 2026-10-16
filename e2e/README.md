# Browser-Smoke

Fährt die echte Oberfläche (Headless-Chromium) gegen einen laufenden Compose-Stack und meldet jede fehlgeschlagene
API-Antwort (4xx/5xx), jeden Konsolen- und Seitenfehler:

1. Organisation über das Registrierungsformular anlegen, Bestätigungslink aus dem Backend-Log einlösen (Mail-Transport `log`),
2. alle Dashboard-Seiten öffnen,
3. Kontakt, Termin, Beitrag, Arbeitsgruppe, Wiki-Artikel, Mitglied und Datei über die Dialoge anlegen,
4. abmelden und mit Passwort anmelden.

```bash
# Stack starten (eigenes Projekt, Mail-Transport log)
docker compose -p pulsedeck-e2e --env-file e2e.env up -d --build
cd e2e && npm install && npx playwright install chromium
E2E_BASE_URL=http://localhost:18095 E2E_COMPOSE="docker compose -p pulsedeck-e2e --env-file ../e2e.env" npm run smoke
```

Exit-Code 0 nur ohne Auffälligkeiten. Erwartung: `AUTH_MIN_RESPONSE_MS=0` im Stack (kürzere Wartezeiten).

## Schreibgeschützte Abnahme mit der Oberfläche

`readonly-login.mjs` prüft gegen einen Stack mit `READ_ONLY=true`, dass die Anmeldung funktioniert (E-Mail-Prüfung, Passwort, Weiterleitung) und nur
Hintergrund-Schreibzugriffe mit 503 abgewiesen werden. Das Konto muss vorher **Mitglied einer Organisation** sein (die Anmeldeseite prüft zuerst die E-Mail
gegen die Mitglieder) und per API angelegt werden, weil Registrieren in dieser Betriebsart gesperrt ist:

```bash
E2E_BASE_URL=http://localhost:18099 E2E_EMAIL=… E2E_PASSWORD=… node readonly-login.mjs
```
