# Migrationsstatus und Umsetzungsreihenfolge

Dauerhafter Fortschrittsnachweis. Kein Schritt verschwindet; Status hier führen.

Reihenfolge-Prinzip (Auftrag §16): **Auth und Autorisierung vor ungeschützten fachlichen Endpunkten.** Jeder fachliche Endpunkt entsteht erst mit Guard + Negativtest.

## Phase 0 — Grundlagen (aktuell)

| Schritt | Status | Nachweis |
|---|---|---|
| Bestandsaufnahme + Abdeckungsmatrix | erledigt 2026-10-13 | `01-abdeckungsmatrix.md` |
| Build-/Testzustand erfasst (build grün, Tests rot durch Bestandsfehler supabase.spec.ts) | erledigt 2026-10-13 | Befehle: `npm run build`, `npm test -- --watch=false` |
| Entscheidungslog eröffnet | eröffnet | `02-entscheidungen-offene-fragen.md` (O1–O8 offen) |
| Testframework-Klärung (O6) | beschlossen: **Vitest überall**; Regeln angepasst | `02-entscheidungen-offene-fragen.md` |
| Bestandsfehler supabase.spec.ts behoben; 6 veraltete Specs repariert (Test-Infra, verhaltensneutral) | erledigt 2026-10-13 | `npm test -- --watch=false`: 7 Dateien/8 Tests grün; `npm run build` grün |
| Backend-Testinfrastruktur `backend/` (Vitest, eigenes package.json) | erledigt 2026-10-13 | `cd backend && npm install && npm test` |
| **Red-Schritt 1: AuthService Passwort-Login** (4 fachliche Tests: Session, falsches Passwort, keine Kontoenumeration, gesperrtes Konto) | **GREEN 2026-10-13** — Red vom Betreiber bestätigt, minimale Implementierung `auth.service.ts` + Port `auth-user.repository.ts`; `cd backend && npm test` → 4/4 grün. Offen: Token sind Platzhalter (shortcut-Kommentar), JWT/Refresh im nächsten Red-Schritt |
| **Red-Schritt 2: Session-Vertrag (JWT via jose, Refresh-Hash-Store, Rotation, Widerruf, Sperrung)** | **GREEN 2026-10-13** — `cd backend && npm test` 10/10; `npx tsc --noEmit` grün |
| **Red-Schritt 3: bcrypt-Hashing mit Supabase-Import-Kompatibilität ($2a$)** | **GREEN 2026-10-13** — `password-hasher.ts` (bcryptjs, Kosten 10); 13/13 Tests |
| **Red-Schritt 4: Registrierung + E-Mail-Verifikation** (generische Antworten, zweckgebundene Tokens, atomar einmalig) | **GREEN 2026-10-13** — Ports `VerificationTokenStore`, `MailSender`; 18/18 Tests |
| **Red-Schritt 5: Magic-Link + Passwort-Reset** (Mails nur an registrierte Konten, einmalige Tokens, Session-Widerruf nach Reset) | **GREEN 2026-10-13** — 24/24 Tests, `npx tsc --noEmit` grün; Test-Helper dedupliziert in `backend/test/auth-memory-stores.ts` |
| Toter Code gelöscht: `features/organizations/create-organization.component.ts` (O7) | erledigt 2026-10-13 | Build + Frontend-Tests grün nach Löschung |
| E11: TDD-Stopp-Punkte vom Betreiber aufgehoben (Test+Implementierung in einem Zug, Verifikation durch Läufe) | beschlossen 2026-10-13 | `02-entscheidungen-offene-fragen.md` |

## Phase 1 — Auth & Autorisierung (vor allem Fachlichen)

### Abschnitt „Auth abschließen, NestJS-App, PostgreSQL-Schicht, Compose-Stack" (Prompt `docs/prompts/nestjs-naechste-schritte.md`, 2026-10-13)

| Schritt | Status | Nachweis |
|---|---|---|
| Folgeauftrag im Repo abgelegt | erledigt 2026-10-13 | `docs/prompts/nestjs-naechste-schritte.md` |
| Schritt A: changePassword (altes Passwort prüfen, Sessions widerrufen, neue Session) | **GREEN 2026-10-13** | `auth.change-password.spec.ts` (4 fachliche Tests, Red verifiziert vor Implementierung) |
| Schritt A: RateLimiter-Port + In-Memory-Implementierung (Festfenster, konfigurierbar) | **GREEN 2026-10-13** | `rate-limiter.spec.ts` (4 Tests); Einbindung: AuthController (Login 5/15 min, Mail-Endpunkte 3/h) |
| Schritt B: NestJS 11.2.7 gepinnt, Gerüst (AppModule, Start-Validierung, Health) | **GREEN 2026-10-13** | `npx tsc --noEmit` grün; `configuration.spec.ts` (6 Tests); Start ohne Konfiguration → Exit 1 mit verständlicher Meldung |
| Schritt B: AuthController `/api/v1/auth/*` (10 Endpunkte), DTOs (class-validator), JwtAuthGuard (jose), Fehlervertrag `{code,message}` | **GREEN 2026-10-13** | `auth.controller.spec.ts` (15 supertest-Tests: Happy Paths, 400, 401, 403, 429, Enumeration-Gleichheit, unbekannte Felder abgewiesen) |
| Schritt B: OpenAPI unter `/api/docs`, Bearer-only | **GREEN 2026-10-13** | `openapi.spec.ts` (Contract-Test: Pfade/Methoden gegen Implementierung); nginx blockt `/api/docs` extern (404, im Compose-Smoke geprüft) |
| Schritt C: node-pg-migrate 9.0.0 + 4 SQL-Migrationen (auth_users/refresh_tokens/verification_tokens/rate_limits + Grants) | **GREEN 2026-10-13** | `npm run migration:up` auf leerer DB + `migration:down` sauber (beide Läufe gegen pg-Container ausgeführt) |
| Schritt C: Pg-Port-Implementierungen (Repository, Refresh, Verification atomar via DELETE…RETURNING, RateLimiter Upsert) | **GREEN 2026-10-13** | `db.integration.spec.ts` (12 Tests gegen echtes PostgreSQL: Verträge, Unique-Constraint, FK-Kaskade, Ablauf, Paralleleinlösung genau ein Gewinner, Rollen-Trennung: Runtime ohne DDL/ohne Owner/kein Zugriff auf pgmigrations, Pool begrenzt + sauber geschlossen) |
| Schritt D: Compose-Stack (postgres pgvector/pg17 ohne öffentlichen Port, backend, frontend, nginx-Routing, Migration-before-serve) | **GREEN 2026-10-13** (im Audit präzisiert) | `docker compose up -d` → `postgres` und `backend` healthy; `frontend` hat **keinen** Healthcheck (nur `Up`, siehe `03-…` K1); Nachweis in `docs/betrieb/selfhosting.md` |
| Schritt D: Auth-Smoke per curl (Signup→Token→Verify→Login→Refresh→Logout; Refresh nach Logout 401; Login nach Backend-Neustart 200) | **GREEN 2026-10-13** | Befehle + Ergebnisse: `docs/betrieb/selfhosting.md` |
| Schritt D: MinIO-Dienst | **teilweise — Umgebung blockiert** | Offizielle MinIO-Images derzeit nicht pullbar (Docker Hub 404, quay 401); Dienst hinter Profil `storage` + `MINIO_IMAGE`-Env; O9 geführt |
| Gates: `cd backend && npm test` → **70/70 grün** (11 Dateien, inkl. 12 DB-Integrationstests gegen echtes PostgreSQL); `npx tsc --noEmit` grün; `npm run build` grün; Frontend `npm run build` grün, `npm test -- --watch=false` → **8/8 grün** | **GRÜN 2026-10-13** (Stand vor dem Audit; aktueller Stand: 76/76, siehe Prüflauf unten) | Befehle wie angegeben, in der Session ausgeführt |

Abweichungen/Offenes aus diesem Abschnitt:
- **O4 offen** → MailSender: `LogMailSender` als dev-Transport (`MAIL_TRANSPORT=log`), in Produktion bei Start-Validierung abgelehnt; produktiver SMTP/Resend-Adapter erst nach O4.
- **O5 offen** → keine OAuth-Endpunkte implementiert (bewusst, kein stiller Wegfall).
- **O9 neu** → MinIO-Image-Bezug blockiert (s. o.); O3 bleibt beschlossen.
- Passwort-Mindestlänge für neue Passwörter: 8 (E12), Bestand hatte keine Frontend-Validierung.

1. DB-Migrationsstrecke: Basisschema (Tabellen aus Bestand, ohne Supabase-Plattformobjekte), Rollen-Trennung (Owner- vs. Runtime-Rolle) — **erledigt für Auth-Tabellen**
2. Auth-Modul: Passwort-Login, Signup, Verifikation, Magic Link, Passwort-Reset/-änderung, Sessions (O2), Logout, Rate-Limits — **Backend erledigt**; OAuth (nach O5-Klärung) offen
3. Membership-Kontext: `get_user_memberships`-Äquivalent, OrgGuard, Rechte-Matrix — **teilweise erledigt 2026-10-14**: Membership-Kontext, OrgGuard, Resolver und lesende Endpunkte umgesetzt; Rechte-Matrix aus dem rekonstruierten Live-Schema abgeleitet als **Vorschlag** (`04-rechte-matrix.md`, Entscheidungen D1–D8 offen); schreibende Mitglieder-/Rollen-Operationen folgen mit Phase 2
4. Negativtests: 2 Orgs, Mehrfachmitgliedschaft, Rollen, fremde UUID, anonymous — gegen echtes PostgreSQL — **erledigt für die Tenancy-Endpunkte 2026-10-14** (`tenancy.integration.spec.ts`, per Mutation geprüft); für jedes weitere Modul pflicht

### Prüflauf (Abgleich-Audit) 2026-10-13

Auftrag: `docs/prompts/abgleich-stand-gegen-auftrag.md`. Vollständiges Protokoll, Abgleich und Lückenbericht: [`03-abgleich-und-luecken.md`](03-abgleich-und-luecken.md). Hier der Nachweis (Befehl + Ergebnis):

| Prüfung | Befehl | Ergebnis |
|---|---|---|
| Backend-Tests | `cd backend && npm test` | vor Korrekturen 70/70, **nach Korrekturen 76/76** (12 Dateien, 12 DB-Tests gegen echtes PostgreSQL), Exit 0 |
| Typecheck / Build Backend | `npx tsc --noEmit`; `npm run build` | grün, Exit 0 / 0 |
| Frontend | `npm run build`; `npm test -- --watch=false` | Build grün (nur Budget-/ESM-Warnungen); 7 Dateien / 8 Tests grün |
| Migration | `npm run migration:up` auf frischer DB; `migration:down` ×5; `down 0` | up: 4 Migrationen; down: eine pro Aufruf, danach nur `pgmigrations` (Buchhaltung); `down 0` rollt alle zurück |
| Compose, frisches Projekt | `docker compose -p pulsedeck-audit up -d --build` (leere Volumes) | Exit 0; `postgres`/`backend` healthy; keine Host-Ports außer Frontend; Rollen-Trennung per psql belegt |
| Migration-before-serve bei Fehler | Backend mit falschem Migrations-Passwort | Exit 1, Server startet nicht |
| Auth-Smoke inkl. Magic-Link, Reset, Rotation, Rate-Limit | curl durch nginx | alle erwarteten Codes; Login nach Backend-Neustart 200 |
| OpenAPI | `/api/docs-json` intern; `/api/docs*` extern | 13 Pfade deckungsgleich; extern 404 (nach M1-Fix für alle Schreibweisen) |
| Startvalidierung | `node dist/main.js` ohne Pflichtwerte / mit `production`+`log` | Exit 1 mit verständlichen Meldungen (E16-Blocker wirkt, auch im Compose-Prod-Override) |
| Neustart mit Datenerhalt; Graceful Shutdown | `docker compose down` (ohne `-v`) + `up`; `docker stop` | Login weiter 200; SIGTERM → Exit 0 in 0,3 s |
| DB-Backup/-Restore | dokumentierte `pg_dump`/`psql`-Befehle in neues Projekt mit frischen Volumes | Prüfsumme der Nutzerdaten identisch; Backend loggt auf Restore-Daten ein (nur DB, gleicher Host) |

**Im Audit gefundene und behobene Mängel** (jeweils Regressionsnachweis zuerst Rot): M1 OpenAPI per Groß-/Kleinschreibung extern lesbar; M2 Passwort-Login ohne bestätigte E-Mail (jetzt 403 `email_not_verified`, Link-Einlösung bestätigt die E-Mail, E19 zur Betreiber-Bestätigung); M3 `.env` und `backend/` im Frontend-Builder-Layer (`.dockerignore`); M4 Einlöse-Token im nginx-Access-Log (Log-Format). Details und Reproduktion: `03-…` §1.3.

Dokumentkorrekturen aus dem Audit: Matrix (Aufrufer von `send-guest-invitation`/`send-push`/`send-event-notification`, `get_member_skills`, Migrationsanzahl, fehlende Dateien, Policy-Zählwert), `02-…` (E19, O10, Aktualisierung von O9/E13), `selfhosting.md` (Healthcheck-Aussage, Smoke-Ergänzungen).

### Folgearbeiten nach dem Audit (2026-10-14)

Freigabe durch den Betreiber: „gogogo“ auf den empfohlenen Plan aus `03-…` §6. Alles lokal auf Branch `migration/nestjs-postgres` committet, nichts gepusht.

| Schritt | Status | Nachweis |
|---|---|---|
| Arbeitsbaum in thematische Commits gegliedert | erledigt | `git log --oneline` (Rules, Frontend-Specs, Löschung toter Code, Backend, Ops, Docs) |
| O10 Egress: Backend in eigenem Netz `egress`, Postgres bleibt intern | erledigt, Betreiber-Bestätigung offen | Backend erreicht das Internet, Postgres nicht (`docker compose exec`); keine Host-Ports außer Frontend |
| O4 Mail: SMTP- und Resend-Transport, Config-Validierung, asynchroner Versand, Compose/Prod verlangt `MAIL_TRANSPORT` | erledigt; realer Anbieter-Versand offen | Spezifikationen für Templates, SMTP (gegen `smtp-server` im Testprozess), Resend (gegen simulierte API), Sender und Konfiguration; Ende-zu-Ende im Prod-Modus mit Mailpit (Mail kommt an, Link aus der Mail löst ein, kein Token im Log, Ausfall liefert unverändert 202) |
| Folge-Audit M5/M6: Timing-Enumeration (Login, Signup, Mail-Endpunkte) und Login-Limit-Umgehung per Schreibweise | erledigt | Messung vorher 0 ms gegen 54 ms, nachher 58 gegen 53 ms; Stack: Reset bekannt 211–222 ms gegen unbekannt 209–210 ms; Tests `auth.timing-equalization.spec.ts`, `auth.controller.enumeration.spec.ts` |
| Replay des Live-Schemas, Rechte-Matrix, Berechtigungsprobe | erledigt (Vorschlag) | `backend/scripts/legacy-replay/` (Replay 3 Schritte, 0 Fehler), `04-rechte-matrix.md` |
| Tenancy-Kern: Migration 000005, `/me/memberships`, `/orgs/:orgId/members/me`, `/orgs/:orgId/roles`, OrgGuard, `RequirePermission`, Kontoverknüpfung per bestätigter E-Mail | erledigt (lesend) | Integrationstests gegen echtes PostgreSQL; 3 Mutationen erkannt; Upgrade der Migration auf bestehender DB und Smoke durch nginx |
| Querschnitt: Request-ID + JSON-Zugriffslog, Passwort-Obergrenze 72 Bytes, Frontend-Healthcheck, `@types/node` 22, In-Memory-Limiter aus `src/` | erledigt | `request-logger.spec.ts`, `auth.dto.spec.ts`; nginx `rid` = Backend `requestId` |
| CI: Workflow `ci.yml` (Backend gegen PostgreSQL, Frontend, Compose-Smoke) und `scripts/smoke-compose.sh` | Smoke lokal belegt, **Workflow noch nicht auf GitHub gelaufen** | `bash scripts/smoke-compose.sh` → „Smoke bestanden“ (20 Prüfungen) |
| O9 MinIO | unverändert blockiert; Alternativen verifiziert (SeaweedFS, RustFS, Zenko pullbar) | `02-…` O9 |

Gates nach diesen Arbeiten (2026-10-14): `cd backend && npm test` → **157/157** (24 Dateien); `npx tsc --noEmit` grün; `npm run build` grün; Frontend `npm run build` grün, `npm test -- --watch=false` → 8/8.

## Phase 2 — fachliche Module — **erledigt 2026-10-14**

Je Modul: Migration, Service/Controller mit Guards, Integrationstests gegen echtes PostgreSQL (Negativtests: fremde Organisation, zu niedrige Rolle, unsichtbares Objekt; per Mutation gegengeprüft). Rechte-Matrix: `04-rechte-matrix.md` §4 (alle Zeilen umgesetzt).

| Modul | Nachweis (Spec) | Migrationen |
|---|---|---|
| Organisationen, Einstellungen, öffentliche Seite | `organizations.integration.spec.ts`, `tenancy.integration.spec.ts` | 000005 |
| Mitglieder, Rollen, Einladung, Erst-Passwort | `members.integration.spec.ts`, `auth.invitations.integration.spec.ts` | 000005, 000012 |
| Skills, Matching; Arbeitsgruppen | `skills.integration.spec.ts`, `working-groups.integration.spec.ts` | 000006, 000007 |
| Termine, Anmeldungen, Schichten, Serien, Gast-Organisationen | `events.integration.spec.ts`, `series.spec.ts` | 000008 |
| Feed (Entwurf/Freigabe/Umfragen/Pinning), Wiki, Kontakte | `feed.integration.spec.ts`, `wiki.integration.spec.ts`, `contacts.integration.spec.ts` | 000009, 000013 |
| Dateien, Ordner, Speicher (E26) | `files.integration.spec.ts`, `object-storage.spec.ts` | 000010 |
| Aktivität: Onboarding, Aufgaben, Analytics, Audit, Feedback, Präsenz, Plattform-Admin | `activity.integration.spec.ts`, `dashboard.service.spec.ts` | 000011, 000016 |

## Phase 3 — Edge-Function-Verlagerung — **erledigt 2026-10-14**

| Edge Function / Job | Ersatz | Nachweis |
|---|---|---|
| `ical-export` | `GET /public/ical` | `calendar.integration.spec.ts`, `ical.spec.ts` |
| `send-newsletter`, Newsletter-Zeitplan | Outbox + Scheduler, Org-SMTP verschlüsselt | `newsletter.integration.spec.ts`, `newsletter.schedule.spec.ts`, `org-smtp.spec.ts`, `smtp-host-guard.spec.ts`, `secret-box.spec.ts`; Migration 000014 |
| `send-event-notification`, `send-push` | Push-Queue in der Transaktion + `PushService` | `push.integration.spec.ts` |
| `chatbot`, `ingest-docs`, `ingest-file`, `match_knowledge` | Chat (AI-SDK-Datenstrom), Wissensbasis, Indexaufträge | `chat.integration.spec.ts`, `knowledge.integration.spec.ts`, `mistral.client.spec.ts`; Migration 000015 |
| `sitemap` | `GET /public/sitemap.xml`, `robots.txt` | Compose-Smoke |
| `send-invitation`, `invite-member`, `generate-magic-link`, `delete-auth-user`, `send-guest-invitation` | Auth-/Mitglieder-/Gäste-Endpunkte | siehe Matrix §2 |
| Realtime (`postgres_changes`) | SSE | `realtime.integration.spec.ts` |
| pg_cron / pg_net | Scheduler mit Claims in `scheduler_state` | `scheduler.service.ts`, Tests der Module |

## Phase 4 — Frontend-Umstellung — **erledigt 2026-10-14**

Angular-App ohne Supabase (`grep -ri supabase src` ohne Treffer): `ApiService`, `SessionService`, `RealtimeService`, alle Services auf die REST-API, `AuthService` API-kompatibel (`currentMember`, `currentOrgId`, `whenReady()`), Payload-Whitelisting, Token aus der URL entfernt. Nachweise: `npm test -- --watch=false` und `npm run build`; **Browser-Test** `e2e/browser-smoke.mjs` (Registrierung, E-Mail-Bestätigung, alle Seiten, Anlegen-Dialoge für Kontakt/Termin/Beitrag/AG/Wiki/Mitglied, Datei-Upload, Passwort-Login: 22 Prüfungen, keine 4xx/5xx/Konsolenfehler), zusätzlich von Hand gefahren: Schichten, Teilnehmerliste, Termin bearbeiten/löschen, Ordner, Suche, Umfrage, Freigabe, Lesemarkierung. Dabei gefundene und behobene Abweichungen: `next_meeting ''`, leere optionale Fremdschlüssel (`api-payloads.spec.ts`).

Native Apps: `npm run build:mobile`, `CORS_ORIGINS` (E36); Geräteprobe offen (O14).

## Phase 5 — Migrationswerkzeuge & Staging-Probelauf — **erledigt 2026-10-14 (gegen synthetischen Altbestand)**

| Nachweis | Befehl | Ergebnis |
|---|---|---|
| Export/Import/Validierung gegen das **echte Altschema** (Replay) | `cd backend && npx vitest run src/migration` | 14 Tests: Manifest, Ausschlüsse, Probelauf, Vollimport mit Umwandlungen, Wiederaufnahme, veralteter Checkpoint, nicht leeres Ziel, beschädigter Export, Schemaabweichung, nicht geratene Entscheidungen, Manipulationserkennung; Mutationen (Checkpoint-Prüfung, Prüfsumme, E-Mail-Normalisierung) werden erkannt |
| Probelauf im isolierten Compose-Projekt (Backend-Image) | `bash scripts/rehearse-migration.sh <export> --platform-admin … --newsletter-org …` | alle Schritte ok: Migrationen, Probelauf, Import, **93 Prüfungen**, `pg_dump` + Dateikopie, Restore in frische DB, **93 Prüfungen** auf dem Restore |
| CLI-Fehlercodes | `node dist/migration/cli.js …` | Exit 2 (Aufruf), 10 (Quelle nicht erreichbar, ohne Zugangsdaten in der Meldung) geprüft |
| Datei-Volume Backup/Restore | `tar` aus/in Volume | 7 Objekte, SHA-256 identisch |
| Abzug des Produktionsstands (Werkzeug) | `scripts/prod-mirror/{capture,restore}.sh`, `parity.mjs` | an prod-ähnlichem lokalem Stand: 33 Tabellen mit identischen Prüfsummen nach Dump→Restore→Export, Dateien identisch; Paritätsbericht findet 6 eingeschleuste Abweichungen |
| Export bricht bei unbekannten Quelltabellen ab | `migration.integration.spec.ts` (15 Tests) | Mutation (Prüfung ausgebaut) wird erkannt |

**Seit 2026-10-14 belegt** (Supabase-MCP, nur lesend; Details und Folgen `05-produktionsbefund.md`): Live-Schema, Realtime-Publication, Cron, Buckets, Konten/Hash-Format, bereitgestellte Edge Functions, Constraint-Verträglichkeit. Dabei gefunden und behoben: führender `/` in `files.storage_path` (Export hätte alle Dateien als fehlend gemeldet), `feed_item_reads`/`is_pinned` fehlen in Prod; gefunden und gemeldet: **eine nicht im Repo geführte, öffentlich aufrufbare Altlast-Funktion in Produktion (O20; Details nur lokal)**.

**Mit Datenbank-Zugang außerdem erledigt:** vollständiger Abzug der Produktion (`capture.sh`), lokale Wiederherstellung (`prod_local`), Paritätsbericht, Export und **Probelauf mit den echten Daten: 89/89 Prüfungen im Import und 89/89 im Restore** (Dateiinhalte als Platzhalter, da der Storage-Zugang fehlt). Alle 13 Produktions-Hashes sind gültiges bcrypt (Kosten 10).

**Rückbau (E38, 2026-10-15):** `supabase/`, `supabase_schema.sql` und der Supabase-Skill sind aus dem Repo entfernt; Replay und Paritätsabgleich laufen ohne sie.

**Umfang E37 (nur eine Organisation)** mit `--only-org` umgesetzt (Tests, Mutationen erkannt) und mit den echten Daten geprobt: 6 von 17 Konten, Probelauf 89/89 im Import und im Restore.

**Weiterhin nicht belegt** (O13): echte Supabase-Hashes, Datenvolumen/Laufzeit, Storage-Spiegel, Dashboard-Tabellen, Supabase-seitiger Schreibstopp.

## Phase 6 — Cutover-Planung — **Plan fertig, Ausführung wartet auf Freigabe (O8)**

Runbook: [`../betrieb/migration.md`](../betrieb/migration.md) (Vorbedingungen, Export, Umwandlungen, Probelauf, Cutover mit Zeitplan und Abbruchkriterien, Folgen für Nutzer/Clients, Rollback, Stilllegung). Bausteine: `READ_ONLY`-Abnahme (Compose-Smoke belegt Sperre und Aufhebung), Rehearsal-Skript, CI-Jobs `migration-rehearsal` und `browser-smoke`. **Supabase wird nicht angerührt**; Stilllegung nur nach ausdrücklicher Freigabe.

### Gates (Stand 2026-10-14, Ende dieses Abschnitts)

Alle Läufe in einem **frischen `git clone`** des Branchs `migration/nestjs-postgres` (Stand Commit `34943b0`), damit nichts Unversioniertes mitspielt:

| Gate | Befehl | Ergebnis |
|---|---|---|
| Backend: Install, Typecheck, Build | `cd backend && npm ci && npx tsc --noEmit && npm run build` | grün / grün / grün |
| Backend: Tests (PostgreSQL-Container auf 5433) | `npx vitest run` | **54 Dateien / 409 Tests grün** (drei aufeinanderfolgende Läufe ohne Flake) |
| Frontend: Install, Build, Tests | `npm ci && npm run build && npm test -- --watch=false` | grün / grün (nur Budget- und ESM-Warnungen, wie im Bestand) / **13 Dateien / 43 Tests grün** |
| Compose-Smoke (isoliertes Projekt, leere Volumes) | `bash scripts/smoke-compose.sh` | „Smoke bestanden“ (51 Prüfungen: Auth, Proxy, Fachfunktionen, Neustart mit Datenerhalt, schreibgeschützte Abnahme) |
| Browser-Smoke (Headless-Chromium gegen den Stack) | `cd e2e && node browser-smoke.mjs` | 22 Prüfungen ok, keine 4xx/5xx, keine Konsolen-/Seitenfehler |
| Migrations-Probe | `bash scripts/rehearse-migration.sh <export> …` | bestanden: 93 Prüfungen Import, 93 Prüfungen Restore |
| Abhängigkeiten | `npm audit --omit=dev` | Frontend: 5 Meldungen (1 hoch: `xlsx`, keine korrigierte Version in der Registry); Backend gesamt: 2 moderate (`js-yaml` über `@nestjs/swagger`) — siehe O15 |

**Nicht** in einer CI-Umgebung gelaufen: der Workflow `.github/workflows/ci.yml` (neue Jobs `migration-rehearsal`, `browser-smoke` inbegriffen) wurde noch nicht auf GitHub ausgeführt; die Schritte wurden lokal in derselben Reihenfolge nachvollzogen.

### Offene Betreiber-Entscheidungen und Restrisiken

Vollständig in `02-entscheidungen-offene-fragen.md` (Abschnitt „Offen“: O4 echter Mailversand, O5/O18 OAuth, O8 Fenster/RPO/RTO, O11/E27 Rechte-Standards D1–D8, O12 Datenschutztext, O13 Supabase-seitige Schritte, O14 Gerätetest, O15 Abhängigkeitsfunde, O16 CSP, O17 PDF-Verarbeitung im Prozess, O19 Backend-Image im Release-Workflow; E19/E21/E26 Bestätigungen). Zusätzlich offen: Selbst-Löschung des eigenen Kontos, Opt-out aus dem Newsletter.
