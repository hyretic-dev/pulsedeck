# Folgeauftrag: PulseDeck-Migration — Auth abschließen, NestJS-App, PostgreSQL-Schicht und Compose-Stack

Diesen Prompt im Root des PulseDeck-Repositories ausführen. Er ist ein Implementierungsauftrag und knüpft an `docs/prompts/supabase-to-nestjs-postgres.md` an; dessen Ziel, Umfang und Arbeitsregeln gelten unverändert weiter. Dieser Prompt beschreibt nur den nächsten Abschnitt.

## 0. Ausgangslage (Stand 2026-10-13, vor Ausführung prüfen)

Vor jedem Schritt den aktuellen Stand verifizieren, nicht blind vertrauen:

- `docs/migration/00-status.md` — Fortschrittsnachweis; `01-abdeckungsmatrix.md` — vollständige Bestandsmatrix; `02-entscheidungen-offene-fragen.md` — Entscheidungen E1–E11 und offene Punkte O1–O8. Diese drei Dateien sind verbindlich und fortzuführen.
- Backend-Kern existiert unter `backend/` (eigenes package.json, Vitest, `npx tsc --noEmit` grün):
  - `backend/src/auth/` — AuthService mit loginWithPassword, refreshSession (Rotation), revokeSession, signUp, verifyEmail, requestMagicLink, consumeMagicLink, requestPasswordReset, resetPassword; Ports AuthUserRepository, RefreshTokenStore, VerificationTokenStore, MailSender, AccessTokenIssuer; TokenService (jose, HS256); BcryptPasswordHasher (Supabase-$2a$-kompatibel).
- 24/24 Unit-Tests grün (`cd backend && npm test`); Frontend grün (`npm run build`, `npm test -- --watch=false`).
- Gefallene Entscheidungen: Vitest überall (O6), Bearer-JWT ohne Cookies (O2), jose (E10), MinIO (O3), bcryptjs wegen Supabase-Hash-Kompatibilität, pg + handgeschriebene Queries + versionierte SQL-Migrationen (E2), API-seitige Autorisierung statt RLS mit dokumentierter Rechte-Matrix (E4), SSE für Realtime (E6), TDD-Stopp-Punkte aufgehoben (E11: Test zuerst, dann Implementierung, Verifikation durch ausgeführte Läufe; kein Warten auf Red-Bestätigung).
- Offen: O4 (Resend-Produktivkey vs. nur SMTP), O5 (welche OAuth-Provider aktiv sind), O8 (Cutover-Fenster, später).
- Arbeitsregeln aus `.agents/rules/` gelten; bei Konflikten gelten die Betreiber-Entscheidungen aus `docs/migration/02-entscheidungen-offene-fragen.md` (Dokumentation der Abweichung dort genügt). Auf Deutsch antworten. Ponytail: kleinste vollständige Lösung; nichts weglassen, was der Auftrag verlangt.

Werkzeughinweis für diese Umgebung: Schreib- und Edit-Werkzeuge melden gelegentlich Erfolg, ohne den Inhalt zu schreiben, oder schreiben in falsche Dateien. Nach jedem Schreibvorgang den Inhalt kurz verifizieren (grep/head); bei Auffälligkeiten Datei einzeln neu schreiben. Kein paralleles Schreiben mehrerer Dateien.

## 1. Schritt A — Rest-Auth im AuthService (weiter Test-zuerst)

Passwort-Änderung für eingeloggte Nutzer: `changePassword(userId, oldPassword, newPassword)` — altes Passwort verifizieren (generischer Fehler bei falschem alten Passwort), neuen bcrypt-Hash setzen, alle Sessions des Nutzers widerrufen (`deleteAllForUser`), neue Session zurückgeben. Fachliche Tests: erfolgreiches Ändern; falsches altes Passwort; unbekannter Nutzer; Sessions danach ungültig.

Rate-Limits für Missbrauchsschutz (Auftrag §5): Login, Magic-Link, Passwort-Reset, E-Mail-Verifikationsversand. Als eigener Port `RateLimiter` (z. B. `consume(key): Promise<RateLimitResult>`), fachliche Tests mit In-Memory-Implementierung: Limit erreicht → Anfrage abgelehnt, gleiche Antwortform für unbekannte und bekannte E-Mails (keine Enumeration über Timing/Antwort). Fenster z. B. 5 Versuche / 15 Minuten pro E-Mail+IP für Login, 3 / Stunde für Mail-Endpunkte. Werte konfigurierbar.

OAuth nicht stillschweigend bauen: Solange O5 ungeklärt ist, keine OAuth-Endpunkte implementieren. Sobald O5 beantwortet ist, nur die bestätigt aktiven Provider implementieren und das im Status dokumentieren.

## 2. Schritt B — NestJS-App-Gerüst und HTTP-API

NestJS (aktuelle stabile 11.x, Node 22, reproduzierbar in `backend/package.json` gepinnt) mit platform-express; Architektur gemäß E1: fachliche Module, Auth als gemeinsame Infrastruktur. Offizielle Doku als Quelle: https://docs.nestjs.com, Einstiegspunkte Authentication und Validation. Nicht aus Funktionsnamen ableiten, was im Auftrag steht.

AuthController unter `/api/v1/auth`: POST `/login`, POST `/refresh`, POST `/logout`, POST `/signup`, POST `/verify-email`, POST `/magic-link` (anfordern), POST `/magic-link/consume`, POST `/password-reset` (anfordern), POST `/password-reset/consume`, POST `/change-password`. Nur Bearer-Transport (O2): Access-Token im `Authorization: Bearer`-Header, Refresh-Token im Body. Keine Cookies.

DTOs mit class-validator und globalem ValidationPipe; Fehlervertrag einheitlich: HTTP-Status korrekt (400/401/403/404/409/429/500), Body-Shape `{ code: string, message: string }`; fachliche Meldungen 1:1 aus dem AuthService übernehmen (generisch, keine Enumeration). Keine Secrets in Responses.

Guard für authentifizierte Endpunkte: Bearer-JWT mit jose verifizieren (Signatur HS256, iss, aud, exp), Nutzer laden und `is_blocked` prüfen; Refresh-Endpunkt separat. Keine Identität aus Client-Feldern.

Konfigurationsvalidierung beim Start (fehlende Pflichtwerte → verständlicher Abbruch): JWT_SECRET (mindestens 32 Bytes, base64 oder Hex), JWT_ISSUER, JWT_AUDIENCE, APP_BASE_URL (Redirect-Basis für Links; einzige erlaubte Basis — keine offenen Redirects), DATABASE_URL/getrennte Runtime- und Migrations-Zugänge, MAIL_* gemäß O4, Rate-Limit-Werte. Keine Secrets in Logs.

OpenAPI via @nestjs/swagger unter `/api/docs`; DTOs und Antworten müssen mit der Implementierung übereinstimmen (Contract-Test: generierte OpenAPI-JSON gegen erwartete Pfade/Methoden prüfen).

Fachliche Tests: Controller-Integrationstests mit supertest (Nest-App mit gemockten Ports): Happy Paths, 400 bei invaliden DTOs, 401 ohne/falschem Token, 429 bei Rate-Limit, Enumeration-Gleichheit unbekannt/bekannt.

## 3. Schritt C — PostgreSQL-Schicht (echte DB, keine Mocks als Nachweis)

node-pg-migrate mit versionierten SQL-Migrationen unter `backend/migrations/`; `npm run migration:up|down`. Kein Auto-Sync in Produktion.

Erste Migrationen (leeres Zielsystem):

- `auth_users`: UUID-PK (bestehende Supabase-UUIDs übernehmbar), email (lowercase, unique, citext oder check), password_hash, email_verified, is_blocked, created_at/updated_at.
- `refresh_tokens`: token_hash PK, user_id FK ON DELETE CASCADE, expires_at; Index auf user_id.
- `verification_tokens`: (purpose, token_hash) PK, user_id FK ON DELETE CASCADE, expires_at; Index auf user_id.
- `rate_limits`: (key, window_start) mit Zähler, Unique-Constraint; atomares Upsert.
- Bereinigung abgelaufener Tokens als Wartungsendpunkt vorbereiten.

Rollen-Trennung (Auftrag §4): Migrations-Owner-Rolle (CREATE/ALTER) und eingeschränkte Runtime-Rolle (SELECT/INSERT/UPDATE/DELETE auf App-Tabellen, kein DDL, kein Owner). In Migrationen und Compose umsetzen; dokumentieren.

Port-Implementierungen (pg, parametrisiert): PgAuthUserRepository, PgRefreshTokenStore, PgVerificationTokenStore (consume atomar via DELETE … RETURNING), PgRateLimiter, MailSender je O4 (SMTP via nodemailer, Resend via fetch — erst nach O4-Klärung; bis dahin Mocks ausschließlich in Tests, niemals als Produktionsadapter).

DB-Integrationstests gegen echtes PostgreSQL (Docker: pg-Container, Test-DB pro Lauf; CI analog). Pflichtnachweise:

- Migration auf leerer DB läuft; alle Ports erfüllen ihre Verträge gegen echte Tabellen.
- Atomarität: zwei parallele consume desselben Tokens → genau einer gewinnt.
- Abgelaufene Tokens werden abgelehnt (expires_at geprüft).
- Pool: begrenzte Größe, keine offenen Handles nach Testende.
- Unit-Tests mit DB-Mocks gelten nicht als Nachweis für Constraint/Atomarität — nur diese Integrationstests.

## 4. Schritt D — Compose-Stack und Betrieb minimal

docker-compose.yml (+ Prod-Override): Dienste postgres (Image mit pgvector, kein öffentlicher Port), backend (NestJS, Health `/health/liveness` und `/health/readiness`), frontend (bestehendes Angular/Nginx-Image), minio (O3, Buckets `files` privat, `avatars` öffentlich). Interne Netze, persistente Volumes.

Migration-before-serve: Backend-Entrypoint führt Migrationen mit der Migrations-Rolle aus, bevor der Server startet; fehlgeschlagene Migration → kein Start.

Reverse-Proxy-Routing (nginx.conf): location `/api/` (und später SSE) vor dem SPA-Fallback; `/api/docs` nur intern oder geschützt; Upload-Limits; `proxy_buffering off` für Stream-Pfade schon jetzt vorbereiten (späterer Chatbot-Stream).

.env.example ohne Secrets, mit allen Pflichtvariablen aus Schritt B; keine Secrets in Build-Args.

Nachweis: `docker compose up` startet den Stack, Health grün, und ein manueller Smoke: Registrierung → Verifikations-Token aus DB holen → E-Mail verifizieren → Login → Refresh → Logout (per curl). Ergebnisse mit Befehlen dokumentieren. Backup-/Restore-Grundlagen (pg_dump-Befehl + MinIO-Mirror) als dokumentierte Befehle ergänzen; vollständiger Restore-Test folgt im Migrationswerkzeug-Abschnitt.

## 5. Schritt E — Dokumentation und Fortschrittsnachweis (kontinuierlich)

- `docs/migration/00-status.md` nach jedem abgeschlossenen Schritt aktualisieren (Befehl + Ergebnis als Nachweis).
- `01-abdeckungsmatrix.md`: Zeilen zu Login/Session/Registrierung/Verifikation/Magic-Link/Reset/Änderung/Rate-Limit auf echten Status mit Nachweis setzen; nichts ungeprüft grün markieren.
- `02-entscheidungen-offene-fragen.md`: neue Entscheidungen ergänzen (z. B. Rate-Limit-Werte, OpenAPI-Zugriff, Poolgrößen); O4/O5 als offene Voraussetzungen führen.
- Gates am Ende grün und im Bericht genannt: `cd backend && npm test && npx tsc --noEmit`, Frontend `npm run build` und `npm test -- --watch=false`. Fehlschläge niemals verschweigen.

## 6. Abnahmekriterien dieses Abschnitts

- `cd backend && npm test` — alle Unit- und Integrationstests grün (inkl. Atomaritätstests gegen echtes PostgreSQL).
- `cd backend && npx tsc --noEmit` — grün.
- `npm run migration:up` auf leerer DB erfolgreich, `migration:down` sauber.
- NestJS-Server startet nur mit vollständiger, validierter Konfiguration; `/api/v1/auth/*` im Compose-Stack per curl nutzbar (Smoke-Nachweis dokumentiert).
- OpenAPI stimmt mit den implementierten Routen überein.
- Compose-Stack startet reproduzierbar; PostgreSQL ohne öffentlichen Port; Health-Checks grün.
- Kein Supabase-Code im Backend; keine Mock-Produktionsadapter; keine TODOs/leeren Methoden.
- Status-, Matrix- und Entscheidungsdokumente aktuell; O4/O5/O8 als offen gekennzeichnet.

## 7. Nicht in diesem Abschnitt (spätere Aufträge)

Fachliche Module jenseits Auth (Organisationen, Mitglieder, Events, Feed, Wiki, Storage, Realtime, Chatbot/RAG), OAuth (bis O5), Migrations-/Exportwerkzeuge für Supabase-Bestandsdaten, produktive Umschaltung, Lasttests. Nach Abnahme dieses Abschnitts folgt ein separater Prompt für Phase 2 (fachliche Module mit Mandantentrennung und Negativtests) auf Basis der Abdeckungsmatrix.
