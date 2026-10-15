# Prüfauftrag: Umgesetzten Migrationsstand gegen den Gesamtauftrag verifizieren und Lücken zusammenfassen

Diesen Prompt im Root des PulseDeck-Repositories ausführen. Er ist ein **Audit- und Berichtsauftrag**, kein Feature-Auftrag: Der bereits implementierte Stand der Migration wird systematisch gegen den Gesamtauftrag und den abgeschlossenen Abschnitt geprüft; danach entsteht ein belastbarer Lückenbericht. Nur wenn der Audit echte Mängel im Bestehenden findet, wird Produktionscode minimal korrigiert (Regressionstest zuerst). Keine neuen Features, keine Umbauten, keine neue Architektur.

## 0. Verbindliche Bezugsdokumente (vor jedem Schritt lesen, nicht blind vertrauen)

- `docs/prompts/supabase-to-nestjs-postgres.md` — Gesamtauftrag (Ziel, Umfang, §§1–16).
- `docs/prompts/nestjs-naechste-schritte.md` — abgeschlossener Abschnitt (Auth abschließen, NestJS, PostgreSQL, Compose) inkl. Abnahmekriterien in §6.
- `docs/migration/00-status.md` (Fortschrittsnachweis), `01-abdeckungsmatrix.md` (Bestandsmatrix), `02-entscheidungen-offene-fragen.md` (E1–E18, O1–O9).
- `docs/betrieb/selfhosting.md` (Compose/Smoke/Backup-Nachweise), `docker-compose.yml`(+`-prod.yml`), `nginx.conf`, `.env.example`, `backend/`.

Arbeitsregeln: `.agents/rules/` gelten; bei Konflikten gelten die Betreiber-Entscheidungen aus `02-entscheidungen-offene-fragen.md`. Auf Deutsch antworten. Ponytail: kleinste vollständige Prüfung, aber keine Behauptung ungeprüft lassen. TDD-Stopp-Punkte sind laut E11 aufgehoben; Verifikation erfolgt ausschließlich durch tatsächlich ausgeführte Läufe.

Werkzeughinweis dieser Umgebung: Schreib-/Edit-Werkzeuge melden gelegentlich Erfolg ohne Inhalt. Nach jedem Schreibvorgang kurz verifizieren (grep/head). Kein paralleles Schreiben mehrerer Dateien.

## 1. Schritt A — Substanzprüfung: Behauptete Nachweise erneut ausführen

Jede grüne Markierung in `00-status.md` und jeder Nachweis in `01-abdeckungsmatrix.md` für den Auth-Abschnitt durch tatsächliche Läufe belegen (Befehl + Ergebnis protokollieren):

1. `cd backend && npm test` — alle Unit- und Integrationstests (inkl. DB-Tests gegen echtes PostgreSQL; Test-Container muss erreichbar sein, sonst `scripts/test-db-setup.mjs` anschubfen).
2. `cd backend && npx tsc --noEmit` und `npm run build`.
3. Frontend: `npm run build` und `npm test -- --watch=false`.
4. `npm run migration:up` auf frischer leerer DB erfolgreich; `migration:down` sauber (mehrfach bis leer; Verhalten dokumentieren).
5. Compose-Stack: `docker compose up -d`, alle Dienste healthy; PostgreSQL ohne öffentlichen Port; `docker compose config` prüfen.
6. Smoke aus `docs/betrieb/selfhosting.md` erneut per curl durchlaufen: Signup → Verify (Token aus Backend-Log) → Login → Refresh → Logout → Refresh danach 401; Login nach Backend-Neustart weiterhin 200.
7. OpenAPI-Contract: `/api/docs-json` enthält genau die implementierten Pfade/Methoden; `/api/docs*` vom Reverse Proxy mit 404 geblockt.
8. Serverstart ohne Pflichtwerte bricht verständlich ab (Exit 1); mit `NODE_ENV=production` + `MAIL_TRANSPORT=log` verweigert er den Start (E16-Blocker wirkt).

Fehlschläge niemals beschönigen: als Rot im Bericht führen, Ursache klären, minimal beheben (Regressionstest zuerst) und die Behebung im Bericht dokumentieren.

## 2. Schritt B — Abnahmekriterien des Abschnitts einzeln abhaken

Die Abnahmekriterien aus `docs/prompts/nestjs-naechste-schritte.md` §6 Punkt für Punkt bewerten (erfüllt / teilweise / nicht erfüllt + Nachweis):

- Alle Backend-Tests grün inkl. Atomaritätstests gegen echtes PostgreSQL; `npx tsc --noEmit` grün.
- `migration:up` auf leerer DB, `migration:down` sauber.
- NestJS-Server startet nur mit vollständiger, validierter Konfiguration; `/api/v1/auth/*` im Compose-Stack per curl nutzbar.
- OpenAPI stimmt mit den implementierten Routen überein.
- Compose-Stack reproduzierbar; PostgreSQL ohne öffentlichen Port; Health grün.
- Kein Supabase-Code im Backend; keine Mock-Produktionsadapter; keine TODOs/leeren Methoden.
- Status-/Matrix-/Entscheidungsdokumente aktuell; O4/O5/O8 als offen gekennzeichnet.

Zusätzlich die bewussten Abweichungen des Abschnitts prüfen und im Bericht klassifizieren (weiterhin tragfähig oder Anpassungsbedarf): LogMailSender als dev-Transport (E16, Produktion blockiert), OpenAPI nur intern (E13), Passwort-Mindestlänge 8 (E12), Rate-Limit-Werte (E14), Poolgröße (E15), Wartungsendpunkt (E17), Fehlervertrag (E18), MinIO hinter Profil `storage` (O9).

## 3. Schritt C — Abgleich gegen den Gesamtauftrag (§§1–16 des Originalprompts)

Für jeden Abschnitt des Gesamtauftrags den Ist-Stand ermitteln und einordnen — erfüllt / teilweise erfüllt / offen, jeweils mit Fundstelle und Nachweis bzw. fehlendem Nachweis. Mindestens:

| Gesamtauftrag | Prüffragen für den Ist-Stand |
|---|---|
| §3 Bestandsaufnahme | Matrix vollständig? Alle Konsumenten, Edge Functions, Cron-Jobs, robots.txt/Storage-URLs erfasst? Nicht-geprüftes als ungeprüft markiert? |
| §4 Architektur | NestJS 11 gepinnt, fachliche Module, `/api/v1`, OpenAPI verifizbar, pg + handgeschriebene Queries, Rollen-Trennung umgesetzt und getestet? |
| §5 Auth | Login/Signup/Verifikation/Magic-Link/Reset/Änderung/Logout/Refresh implementiert und geprüft? Rate-Limits wirksam? OAuth bewusst offen (O5)? Sessionstrategie (O2, Bearer) dokumentiert und getestet? Benutzerimport/Bestandslinks/Supabase-Refresh-Tokens als offene Übergänge geführt? |
| §6 Autorisierung | Mandantentrennung fehlt noch vollständig? Widersprüche Legacy-/neues Rollenmodell dokumentiert? Offen als rot markiert (nicht still als erledigt)? |
| §7 Datenbank | Nur Auth-Tabellen migriert; restliche Tabellen/Trigger/RPCs offen? Transaktionsgrenzen für künnnftige Composite-Operationen als Aufgabe geführt? |
| §8 Storage | MinIO entschieden (O3), aber Betrieb blockiert (O9); Buckets, Upload-Verträge, URL-Remapping offen? |
| §9 Realtime/Jobs | SSE (E6) entschieden, aber Endpunkte offen? Cron-/Queue-Migration offen? |
| §10 Mail/Push/iCal | Mail an O4 gebunden; VAPID, iCal, Sitemap, robots.txt offen? |
| §11 Chatbot/RAG | Komplett offen; Stream-Vertrag (E7) und pgvector-Vorbereitung dokumentiert? |
| §12 Angular | Frontend noch auf Supabase (Phase 4) — als offen geführt, kein verfrühtes Grün? |
| §13 Betrieb | Compose + Health + Migration-before-serve da; TLS, Restore-Test, Log-/Alarmkonzept, CI offen? |
| §14 Cutover | Werkzeuge, Staging-Probelauf, Runbook offen (Phase 5/6, O8)? |
| §15 Tests | Welche Pflichtnachweise sind bereits belegt, welche offen (Negativtests Mandanten, E2E, Lasttests, Restore, gesperrter Supabase-Zugang, Abschluss-Suche)? |

Bei jedem Punkt: nichts ungeprüft grün markieren; „behauptet" und „belegt" trennen.

## 4. Schritt D — Lückenbericht erstellen

Als neue Datei `docs/migration/03-abgleich-und-luecken.md` mit festem Aufbau:

1. **Prüflauf-Protokoll**: alle Befehle aus Schritt A mit Ergebnissen (Datum, Exit-Codes, Testzahlen).
2. **Abnahmeabschnitt**: Kriterienliste §6 des Folgeauftrags mit Status + Nachweis.
3. **Gesamtauftrags-Abgleich**: Tabelle §§1–16 mit Ist-Stand und Fundstellen (Verweis auf Matrix-Zeilen).
4. **Bewusste Abweichungen** (E12–E18, O9) mit Bewertung, ob sie weiter tragfähig sind.
5. **Fehlende Dinge, gruppiert:**
   a. **Betreiber-Entscheidungen (blockierend)**: O4 Mail (Resend-Key vorhanden vs. nur SMTP → produzier Mail-Adapter), O5 OAuth-Provider (Dashboard prüfen), O9 MinIO-Image-Bezug (Mirror/Eigen-Registry), O8 Cutover-Fenster/RPO/RTO (später).
   b. **Produktive Parität ungeprüft** (Supabase-Zugang vorhanden, Daten noch nicht geholt): echter Schemaexport + installierte Migrationen, `auth.users` inkl. Passwort-Hashes, aktivierte Provider, Mailvorlagen/Redirects, Storage-Inventar `files`/`avatars`, VAPID-Schlüssel, pg_cron-Schedules, Realtime-Konfiguration.
   c. **Restarbeit je Phase** (Reihenfolge aus `00-status.md`): Phase 1 Rest (Membership-Kontext, OrgGuard, Rechte-Matrix, Mandanten-Negativtests), Phase 2 fachliche Module, Phase 3 Edge-Functions/Realtime/Jobs, Phase 4 Frontend-Umstellung, Phase 5 Migrations-/Exportwerkzeuge + Staging-Probelauf + Restore-Test, Phase 6 Cutover-Runbook; querschnittlich Lasttests, gesperrter-Supabase-Nachweis, CI, TLS/Beobachtbarkeit/Alarme.
   d. **Hausarbeiten des aktuellen Stands**: Commit-Struktur für den uncommitteten Arbeitsbaum, laufende Container (Compose-Stack Port 8080, Test-PG Port 5433), evtl. weitere im Audit gefundene Kleinteiligkeiten.
6. **Empfohlene nächste Schritte** mit Begründung und Reihenfolge (was ohne Betreiber-Entscheidung startbar ist).

`00-status.md` um den Prüflauf ergänzen (Befehl + Ergebnis); `01-abdeckungsmatrix.md` und `02-entscheidungen-offene-fragen.md` korrigieren, wenn der Audit Ungenauigkeiten findet. Der Bericht endet mit den Gates (`cd backend && npm test && npx tsc --noEmit`, Frontend-Build/-Tests) und nennt Fehlschläge ausdrücklich.

## 5. Abnahmekriterien dieses Prüfauftrags

- Jede grüne Aussage im Bericht beruht auf einem in diesem Prüflauf ausgeführten Befehl (Befehl + Ergebnis stehen im Protokoll).
- Jede Abweichung, jeder Kompromiss und jede bewusste Blockade (O4/O5/O9) ist klassifiziert und benannt; nichts ist still als erledigt markiert.
- Der Lückenbericht trennt strikt: Betreiber-Entscheidungen / ungeprüfte produktive Daten / Restarbeit / Hausarbeiten.
- Gefundene echte Mängel am Bestehenden sind behoben (Regressionstest zuerst) und im Protokoll vermerkt — oder als Rot mit Reproduktionsschritten gemeldet, wenn die Behebung außerhalb dieses Auftrags liegt.
- Nach Abschluss sind die drei Migrationsdokumente (00/01/02) und der neue Bericht (03) konsistent; Gates grün oder mit Begründung rot.
