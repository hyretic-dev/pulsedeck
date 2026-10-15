# Abgleich Stand gegen Auftrag und Lückenbericht

> **Hinweis (2026-10-15):** Pfade der Form `supabase/…` und `supabase_schema.sql` verweisen auf das aus dem Repo **entfernte** Verzeichnis (Rückbau, E38). Den Stand davor zeigt `git show 9b44e20:<pfad>`; die Migrationsversionen und Edge-Function-Namen stehen eingefroren in `scripts/prod-mirror/legacy-repo.json`.

Prüflauf vom **2026-10-13** (ca. 21:24–21:45 MESZ), Audit nach `docs/prompts/abgleich-stand-gegen-auftrag.md`. Geprüft wurde der Stand des Arbeitsbaums (unkommittet) gegen den Gesamtauftrag (`supabase-to-nestjs-postgres.md`) und den Abschnitt „Auth abschließen, NestJS, PostgreSQL, Compose“ (`nestjs-naechste-schritte.md`).

Belegarten in diesem Bericht:

- **B-Lauf** = in diesem Prüflauf ausgeführt, Befehl und Ergebnis stehen im Protokoll (§1).
- **B-Code** = Datei/Code gelesen, aber nicht ausgeführt.
- **Doku** = nur in den Migrationsdokumenten behauptet, hier nicht nachgeprüft.
- **ungeprüft** = kein Nachweis vorhanden.

## Kurzfazit

- Der **Auth-Abschnitt ist funktional belegt**: 76/76 Backend-Tests (davon 12 gegen echtes PostgreSQL), Typecheck, Build, Migration up/down, frischer Compose-Stack, curl-Smoke inkl. Magic-Link, Reset, Rotation, Rate-Limit und Restore der DB in ein neues System.
- Der Audit hat **vier echte Mängel** im Bestehenden gefunden und behoben (Regressionsnachweis jeweils zuerst Rot): M1 OpenAPI per Schreibweise extern lesbar, M2 Login ohne bestätigte E-Mail, M3 `.env`/`backend/` im Frontend-Builder-Layer, M4 Einlöse-Token im nginx-Access-Log (§1.3). **Nachtrag 2026-10-14:** zwei weitere Mängel (M5 Timing-Enumeration, M6 Login-Limit per Schreibweise umgehbar) und eine Korrektur meiner Aussage „Enumeration-Gleichheit belegt“, siehe §8.
- **Die Migration insgesamt ist nicht weit fortgeschritten**: Von den Gesamtauftrags-Abschnitten §3–§16 ist nur das Auth-Fundament belegt. Autorisierung/Mandantentrennung (§6), alle fachlichen Module (§7), Storage, Realtime, Jobs, Mail/Push/iCal, Chatbot, Frontend-Umstellung, Migrationswerkzeuge und Cutover sind **offen** und in den Dokumenten auch als offen geführt (kein verfrühtes Grün gefunden).
- Die Dokumente enthielten **Ungenauigkeiten** (u. a. falscher Aufrufer für `send-guest-invitation`, „alle Dienste healthy“, Policy-Zählwert 101 nicht reproduzierbar). Sie sind korrigiert (§5).
- Wichtigste Struktur-Erkenntnis für die Reihenfolge: Das Frontend kann Auth **nicht allein** umstellen. Supabase akzeptiert unsere JWTs nicht, die Datenzugriffe (RLS) hängen noch an der Supabase-Session. Die Frontend-Umstellung folgt daher zusammen mit den Datenmodulen (siehe §6).

---

## 1. Prüflauf-Protokoll

### 1.1 Schritt A: Befehle und Ergebnisse

| # | Prüfung | Befehl / Vorgehen | Ergebnis | Exit |
|---|---|---|---|---|
| A1 | Backend-Tests | `cd backend && npm test` | **Vor** den Korrekturen: 11 Dateien / **70** Tests grün. **Nach** den Korrekturen: 12 Dateien / **76** Tests grün (+5 in `auth.email-verification.spec.ts`, +1 in `openapi.spec.ts`). Enthält 12 DB-Integrationstests gegen den echten PostgreSQL-Container `pulsedeck-pg-test` (Port 5433), darunter Paralleleinlösung „genau ein Gewinner“, Ablauf, FK-Kaskade, Rollen-Trennung, begrenzter Pool. | 0 |
| A2 | Typecheck/Build Backend | `cd backend && npx tsc --noEmit`; `npm run build` | grün (vor und nach den Korrekturen) | 0 / 0 |
| A3 | Frontend | `npm run build`; `npm test -- --watch=false` | Build grün (Warnungen: Initial-Bundle 908 kB über 500-kB-Budget, `members.css` +596 B, `quill-delta` nicht ESM). Tests: 7 Dateien / **8** Tests grün. stderr-Rauschen: `Error refreshing mikrotasks: TypeError: fetch failed` (ein Bestandstest greift real aufs Netz, siehe K11). | 0 / 0 |
| A4 | Migration up/down | frische DB `audit_mig` (Owner `pulsedeck_migrations`): `npm run migration:up`, 2. `up`, `migration:down` ×5, `up`, `down 0` | `up`: 4 Migrationen, Exit 0; Tabellen `auth_users`, `refresh_tokens`, `verification_tokens`, `rate_limits` (+ `pgmigrations`); Runtime-Rolle hat je Tabelle SELECT/INSERT/UPDATE/DELETE. 2. `up`: „No migrations to run“. `down`: **eine** Migration pro Aufruf (000004→000001), 5. Aufruf „No migrations to run“; danach bleibt nur die Buchhaltungstabelle `pgmigrations`, Extension `citext` ist entfernt. Erneutes `up` ok. `down 0` rollt alle vier in einem Aufruf zurück. | 0 |
| A5 | Compose-Stack | Haupt-Stack (Port 8080) geprüft; zusätzlich **frisches Projekt** `docker compose -p pulsedeck-audit --env-file <Wegwerf-Secrets> up -d --build` mit leeren Volumes, Port 18080 | Exit 0. `postgres` und `backend` **(healthy)**; `frontend` ist `Up` **ohne Healthcheck** (K1). Host-PortBindings: `postgres {}`, `backend {}`, nur `frontend 18080→80`. Netzwerk `internal` hat `internal=true`. Migrationen laufen im Backend-Log vor „HTTP auf Port 3000“. `docker compose config --quiet` für Basis und Prod-Override: Exit 0. Rollen: `pulsedeck_admin` superuser, `pulsedeck_migrations`/`pulsedeck_runtime` weder super noch `BYPASSRLS`; Tabellenowner = `pulsedeck_migrations`. Als `pulsedeck_runtime`: `ALTER TABLE`/`DROP TABLE` → „must be owner“, `SELECT` auf `pgmigrations` → „permission denied“. | 0 |
| A5b | Migration-before-serve bei Fehler | `docker compose run --rm --no-deps -e MIGRATIONS_DATABASE_URL=<falsches Passwort> backend` | Migration scheitert (`auth_failed`), **Exit 1, kein „HTTP auf Port“**: Server startet nicht. | 1 (erwartet) |
| A6 | Auth-Smoke per curl (durch nginx) | siehe §1.2 | Alle erwarteten Statuscodes erreicht; Login nach Backend-Neustart 200. | – |
| A7 | OpenAPI | `docker compose exec backend wget -qO- http://127.0.0.1:3000/api/docs-json`; externe Aufrufe über nginx | Intern 13 Pfade = 10 Auth (alle POST) + 1 Wartung (POST) + 2 Health (GET), deckungsgleich mit dem Contract-Test. Extern 404 für `/api/docs`, `/api/docs-json`, `/api/docs/`, `/api/docs/swagger-ui-init.js`. **Vor** Fix war `/api/DOCS-json` extern 200 (M1); **nach** Fix liefern alle getesteten Schreibweisen 404. | 0 |
| A8 | Startvalidierung | `node dist/main.js` mit (a) leerer Umgebung, (b) `NODE_ENV=production`+`MAIL_TRANSPORT=log`, (c) wie (b) ohne `production`, (d) 16-Byte-Secret/ungültige URL, (e) `PG_POOL_MAX=abc`; plus Compose mit `-f docker-compose.prod.yml` | (a) Exit 1, 6 verständliche Meldungen; (b) Exit 1: „MAIL_TRANSPORT='log' ist in der Produktion nicht zulässig (O4 offen)“; (c) Server startet (Kontrolle: der Blocker kommt nur von `production`); (d) Exit 1, 3 Meldungen; (e) Exit 1. Compose-Prod-Override: Backend in Restart-Schleife mit derselben Meldung (E16 wirkt auch im Compose-Kontext). | 1 (erwartet) |

### 1.2 Auth-Smoke (Statuscodes; keine Tokens protokolliert)

Neues Projekt, nach den Korrekturen. Verifikations-/Magic-/Reset-Tokens aus dem Backend-Log (dev-Transport).

| Fall | Ergebnis |
|---|---|
| Signup | 202 |
| Login **vor** Verifikation (korrektes Passwort) | **403 `email_not_verified`** (vor Fix: 200 mit Session, M2) |
| Verify-Email → Session | 200, `userId` als UUID |
| Verify-Token erneut | 401 `link_invalid` |
| Login / Refresh (Rotation) | 200 / 200 |
| Altes Refresh-Token erneut | 401 `session_invalid` |
| Logout (Bearer + Refresh im Body) | 204 |
| Refresh nach Logout | 401 `session_invalid` |
| Logout / Change-Password ohne Bearer | 401 / 401 |
| Falsches Passwort vs. unbekannte E-Mail | 401 `invalid_credentials` / 401 `invalid_credentials` (identisch) |
| Signup mit bestehender E-Mail | 202, Body identisch zum Erst-Signup |
| Passwort mit 7 Zeichen / unbekanntes Feld | 400 `validation_failed` / 400 `validation_failed` |
| **Login nach `docker compose restart backend`** | **200** |
| Magic-Link anfordern → einlösen → erneut einlösen | 202 → 200 → 401 `link_invalid`; danach Passwort-Login 200 (E-Mail durch Postfach-Nachweis bestätigt) |
| Reset anfordern → einlösen | 202 → 200; altes Passwort 401, neues 200 |
| Change-Password falsches/richtiges altes Passwort | 403 `invalid_current_password` / 200 |
| Manipuliertes Bearer-Token | 401 |
| Fremder `Host`/`X-Forwarded-Host` beim Link-Versand | Link-Basis bleibt `APP_BASE_URL` (kein offener Redirect über Host-Header) |
| Login-Rate-Limit | 5×401, dann 429; **auch mit gefälschtem `X-Forwarded-For` weiter 429** |
| Wartungsendpunkt ohne / mit falschem / mit richtigem Token | 404 / 404 / 204 |
| Unbekannter API-Pfad | 404 `not_found` im Fehlervertrag `{code,message}` |
| SPA-Fallback `/login`, `/:slug/dashboard` | 200 |
| Log-Stichprobe | kein JWT, kein Klartext-Passwort, kein Wartungstoken im Log; Token-Links nur im Backend-Log des dev-Transports (K3) |

### 1.3 Gefundene Mängel und Behebung (jeweils Regressionsnachweis zuerst Rot)

| ID | Mangel | Reproduktion | Ursache | Regressionsnachweis (Rot → Grün) | Behebung |
|---|---|---|---|---|---|
| **M1** | OpenAPI trotz E13 extern lesbar | `curl -s -o /dev/null -w '%{http_code}' http://localhost:8080/api/DOCS-json` → **200**, JSON mit allen 13 Pfaden. `/api/Docs` lieferte die Swagger-UI. | Express routet standardmäßig case-insensitive, der nginx-Block `location ~ ^/api/docs` ist case-sensitive. | `openapi.spec.ts` („OpenAPI nur unter exakt kleingeschriebenem Pfad“): Rot `expected 200 to be 404`, danach Grün. Zusätzlich curl durch den Proxy: alle Varianten 404. | `createHttpAdapter()` in `app.bootstrap.ts` (case-sensitive Router, verwendet von `main.ts` und Test-Helper) und nginx `location ~* ^/api/docs`. Hinweis: Der erste Versuch (`app.set('case sensitive routing')`) wirkte nicht, weil der `ExpressAdapter` den Router schon im Konstruktor anlegt; im Code kommentiert. |
| **M2** | E-Mail-Verifikation wirkungslos | Signup, dann Login mit korrektem Passwort → **200 + Access-/Refresh-Token**, ohne je den Link zu öffnen. | `emailVerified` wird geladen, aber im `AuthService` nirgends geprüft. Mit dem späteren E-Mail-basierten Mitglieds-Linking (`handle_new_user_linking` im Bestand) wäre das eine Account-Übernahme (Gesamtauftrag §5). | `auth.email-verification.spec.ts`: 3 von 5 Tests Rot (Login lieferte Session; Magic-Link/Reset bestätigten die E-Mail nicht), danach 5/5 Grün. curl: Zeilen „Login vor Verifikation“ 403 und „Magic-Link → Login“ 200. | `loginWithPassword`: nach Passwort- und Sperrprüfung `403 email_not_verified` (keine Enumeration: unbekannt/falsch bleibt 401). `consumeLoginToken`: Einlösen von Magic-Link/Reset markiert die E-Mail als bestätigt (ohne diesen Ausweg wäre ein Konto ohne erneute Verifikationsmail gesperrt, denn `signUp` mit bestehender E-Mail sendet nichts). Als **E19 zur Bestätigung durch den Betreiber** geführt, siehe `02-…`. |
| **M3** | Secrets/Backend im Frontend-Builder-Layer | `docker build --target build -t probe . && docker run --rm --entrypoint sh probe -c 'ls -la /app/.env; ls -d /app/backend'` → `.env` (alle Compose-Secrets) und `backend/` samt `node_modules` (162 MB) vorhanden. | `.dockerignore` kannte weder `.env*` noch `backend`; `Dockerfile` macht `COPY . .`. Das Final-Image (nginx, kopiert nur `dist`) war nach Code-Lesung nicht betroffen, wohl aber Builder-Layer/Build-Cache (Gesamtauftrag §12: keine Secrets in Images). | Derselbe Befehl nach Fix: `ls: /app/.env: No such file`, `ls: /app/backend: No such file`, `.env.example` bleibt; Stage-Build inkl. `npm run build` Exit 0. | `.dockerignore`: `.env`, `.env.*`, `!.env.example`, `backend`. |
| **M4** | Einlöse-Token im nginx-Access-Log | `curl "http://localhost:8080/auth/callback?token=probe"` → `docker compose logs frontend` zeigt `"GET /auth/callback?token=probe HTTP/1.1"`. Zusätzlich hätte `$http_referer` den Token bei jedem folgenden Same-Origin-Request wiederholt. | `log_format` nutzte `$request` und `$http_referer`. Der Link `APP_BASE_URL/auth/callback?token=…` wird vom Backend erzeugt (Gesamtauftrag §5, §10: Tokens/Kalender-Token nicht in Logs). | Vorher/Nachher-Probe mit zwei Marken (Query, Referer): 1 bzw. 0 Treffer im Log. | `nginx.conf`: Pfad aus `$request_uri` ohne Query (per `map`), `$http_referer` entfernt. Der Routenpfad bleibt sichtbar (`GET /auth/callback`), API weiter 200. |

In `02-entscheidungen-offene-fragen.md` geführt als **E19** (M2, Betreiber-Bestätigung offen) und **E20** (M1 + M4, umgesetzt). M3 betrifft nur die Build-Konfiguration.

Der Haupt-Stack (Port 8080) wurde nach den Korrekturen per `docker compose up -d --build` neu erzeugt (Volumes erhalten, Bestandskonto `smoke@example.org` loggt weiter mit 200 ein). Die Audit-Projekte (`pulsedeck-audit`, `pulsedeck-restore`) sind samt Volumes entfernt.

### 1.4 Backup/Restore-Probe (zusätzlich, weil in §13/§15 gefordert)

| Schritt | Ergebnis |
|---|---|
| Backup mit dem dokumentierten Befehl (`pg_dump … \| gzip`) | Exit 0, 2 694 B |
| Neues Projekt `pulsedeck-restore` mit **frischen Volumes**, nur `postgres` | healthy, 0 Tabellen vor Restore |
| Restore mit dem dokumentierten Befehl (`gunzip -c … \| psql -v ON_ERROR_STOP=1`) | Exit 0, 0 Fehlerzeilen |
| Vergleich Quelle ↔ Ziel | 3 Nutzer, 7 Refresh-Tokens, 4 Migrationseinträge identisch; md5-Prüfsumme über `id\|email\|password_hash\|email_verified\|is_blocked` identisch (`9ac12494…`); Tabellenowner und 16 Runtime-Grants übernommen |
| Backend auf Restore-Daten starten | „No migrations to run“, healthy; Login mit dem Quell-Passwort 200, mit dem überschriebenen alten Passwort 401 |

**Grenzen:** gleicher Host (kein separates System), nur Datenbank (kein Storage, MinIO nicht lauffähig), Konfiguration/Secrets nicht Teil, Datenmenge winzig (keine Aussage zu Dauer/RTO), kein WAL/PITR. Der vollständige Restore-Test (§15) bleibt offen.

---

## 2. Abnahmeabschnitt (§6 des Folgeauftrags)

| Kriterium | Status | Nachweis / Einschränkung |
|---|---|---|
| `cd backend && npm test` alle Unit- und Integrationstests grün, inkl. Atomarität gegen echtes PostgreSQL | **erfüllt** | A1: 76/76; Atomarität: `db.integration.spec.ts` „genau einen Gewinner“ gegen PostgreSQL (B-Lauf). |
| `npx tsc --noEmit` grün | **erfüllt** | A2. |
| `migration:up` auf leerer DB, `migration:down` sauber | **erfüllt** | A4. Hinweis: `pgmigrations` bleibt als Buchhaltungstabelle zurück (Verhalten von node-pg-migrate, dokumentiert). |
| Server startet nur mit vollständiger, validierter Konfiguration | **erfüllt** mit Lücke | A8. Lücke: `MIGRATIONS_DATABASE_URL` wird nicht von der Startvalidierung geprüft; der Entrypoint scheitert dann separat und verständlich genug mit Exit 1 (A5b) (K8). |
| `/api/v1/auth/*` im Compose-Stack per curl nutzbar | **erfüllt** | A6/§1.2, jetzt auch Magic-Link, Reset, Change-Password. |
| OpenAPI stimmt mit den implementierten Routen überein | **erfüllt** | A7: 13 Pfade/Methoden deckungsgleich mit Implementierung und Contract-Test. Einschränkung: Fehlerantworten (z. B. 403 `email_not_verified`, 429) sind in der Spec nicht dokumentiert. |
| `/api/docs*` extern nicht erreichbar (E13) | **erfüllt nach Fix** | Vor dem Audit **teilweise** (M1). |
| Compose reproduzierbar, PostgreSQL ohne öffentlichen Port | **erfüllt** | A5: frisches Projekt mit leeren Volumes; `docker port`/`PortBindings` leer für `postgres` und `backend`. |
| Health-Checks grün | **teilweise** | `postgres`, `backend` healthy. `frontend` hat **keinen** Healthcheck (K1); die Doku behauptete „alle healthy“ (korrigiert). |
| Kein Supabase-Code im Backend | **erfüllt** | `grep -rniE supabase backend/{src,test,migrations,scripts,package.json,Dockerfile,…}`: 11 Treffer, alle Kommentare/Testdaten zur Hash-Kompatibilität bzw. Auftragsverweise (historische Quelle), kein Import, keine Abhängigkeit. |
| Keine Mock-Produktionsadapter | **erfüllt mit Einschränkung** | `LogMailSender` ist der einzige verdrahtete Mail-Adapter (dev-Transport) und wird nur über die Startvalidierung aus der Produktion ausgeschlossen (K4). `InMemoryRateLimiter` liegt in `src/auth/`, ist aber nicht verdrahtet (K7). |
| Keine TODOs/leeren Methoden | **erfüllt** | `grep -rnE 'TODO\|FIXME\|XXX\|HACK\|shortcut\|Platzhalter\|placeholder'` → 0 Treffer; leere Rümpfe nur bei Konstruktoren mit Parameter-Properties und leeren DTO-Unterklassen. |
| Status-/Matrix-/Entscheidungsdokumente aktuell; O4/O5/O8 offen | **erfüllt nach Korrektur** | Vor dem Audit **teilweise**: Zählwerte, Aufrufer und Gate-Zahlen waren ungenau (§5). O4/O5/O8/O9 stehen als offen, nichts wurde still als erledigt markiert. |

---

## 3. Gesamtauftrags-Abgleich (§§1–16)

Status: **erfüllt** / **teilweise** / **offen**. „Matrix“ verweist auf `01-abdeckungsmatrix.md` (Abschnitte 1–5).

| § | Anforderung (Kern) | Ist-Stand | Status | Belegart | Fehlender Nachweis / Anmerkung | Matrix |
|---|---|---|---|---|---|---|
| 1 | Supabase vollständig ablösen, Daten und Benutzer migrieren | Supabase ist weiterhin die einzige Datenbasis des Frontends; nur Auth-Backend existiert. | **offen** | B-Code | Auftrag erst mit Abschnitten unten erfüllt. | alle |
| 2 | Arbeitsregeln, Fortschrittsnachweis, Entscheidungslog | `00/01/02` geführt; TDD-Stopp-Punkte per E11 aufgehoben; Vitest überall (O6). | **erfüllt** (für den bisherigen Umfang) | Doku + B-Lauf | `AGENTS.md` existiert im Repo nicht (der Auftrag nennt sie); Regeln liegen unter `.agents/rules/`. | – |
| 3 | Bestandsaufnahme/Abdeckungsmatrix | Matrix deckt 31 Tabellen (Abgleich mit allen `.from('…')`-Aufrufen im Code: identisch), 13 Edge Functions, RPCs, Storage, Realtime ab. Audit fand Ungenauigkeiten (§5). **Nicht erfasst** waren `supabase/config.toml`, `seed_demo_data.sql`, `supabase_schema.sql`, `test-ai.*`/`test-embed.ts`, `.dockerignore`, `ngsw-config.json`; jetzt ergänzt. Aufrufer von `send-push`, `send-event-notification`, `send-guest-invitation` sind im Repo **nicht** belegt (Trigger legen nur Queue-Zeilen an). Live-Schema nie gesehen. | **teilweise** | B-Lauf (Greps) | Produktive Parität ungeprüft (O1: Zugang vorhanden, Daten nicht geholt). Policy-/Funktions-/Trigger-Zählwerte sind nicht reproduzierbar (§5). | alle |
| 4 | Architektur: NestJS, `/api/v1`, OpenAPI, pg+SQL, Rollen-Trennung | NestJS 11.2.7 gepinnt (exakt), Node 22, `/api/v1`, OpenAPI Contract-Test, `pg` mit parametrisierten Queries, Rollen-Trennung und begrenzter Pool belegt. Fachliche Module: nur `auth`, `health`, `maintenance`. | **teilweise** | B-Lauf | Weitere Module offen. K6: `@types/node ^26` bei Laufzeit Node 22. | §1 |
| 5 | Auth: Passwort, Signup, Verifikation, Magic-Link, Reset, Änderung, Logout, Refresh, Rate-Limits | Alle genannten Flüsse implementiert und per curl und Tests belegt (nach M2 wirksam). Bearer-JWT (HS256, iss/aud/exp geprüft, B-Code), Refresh serverseitig als Hash, Rotation, Widerruf. Rate-Limits wirksam und nicht per `X-Forwarded-For` umgehbar. **Offen:** OAuth (O5, bewusst nicht gebaut), Einladungsflüsse (`send-invitation`, `invite-member`, `generate-magic-link` als Admin-Funktion, `delete-auth-user`), Benutzerimport inkl. Hashes, Übergang Bestandslinks und Supabase-Refresh-Tokens (Neu-Login nötig), Sessionspeicherung gegen XSS im Frontend (O2-Folge), CORS/Capacitor-Origin, Hash-Upgrade nach Login (bcrypt bleibt), Geräte-/Mehrfachsession-Verwaltung (kein „alle abmelden“ außer Passwortwechsel), Passwort-Obergrenze (bcrypt kürzt bei 72 Bytes still, kein `MaxLength`). | **teilweise** | B-Lauf | Echte Supabase-Hashes nie gegen `bcryptjs` geprüft (nur synthetisches `$2a$`-Beispiel im Test). | §1 (Login, Passwort, Magic-Link, OAuth), §2 (Einladungen) |
| 6 | Autorisierung/Mandantentrennung/Rechte-Matrix | **Nicht vorhanden.** Kein Membership-Kontext, kein OrgGuard, keine Rechte-Matrix, keine Mandanten-Negativtests. Der Guard liefert nur `userId`. Widerspruch Legacy/neues Rollenmodell ist in der Matrix vermerkt (z. B. `committee` im `AuthService`). Wird in `00-status.md` als offen geführt, nicht als erledigt. | **offen** | B-Code | Alle Negativtests (2 Orgs, Mehrfachmitgliedschaft, fremde UUID, anonymous) fehlen. | §3 (Mitgliedschaften & Rollen, RPC, Helper) |
| 7 | Datenbank, Migrationen, fachliche Parität, Transaktionen | Nur 4 Auth-Migrationen. 31 Fachtabellen, RLS, Trigger, SQL-Funktionen, Importstrecke offen. Transaktionsgrenzen für Composite-Operationen sind als Entscheidung (E5) und in den Matrixzeilen („atomare Transaktion“) beschrieben, nicht umgesetzt. | **teilweise** (nur Auth) | B-Lauf | Parallelitätstests für Slots/Votes/Org-Erstellung offen. | §3 |
| 8 | Storage/Dateien | Entscheidung MinIO (O3) steht; Betrieb blockiert (O9): `docker manifest inspect minio/minio`, `minio/mc`, `quay.io/minio/minio` heute weiter **nicht erreichbar** (Docker Hub `denied/authentication required`, quay `no such manifest`). Dienste hinter Profil `storage` nie gestartet. Keine Buckets, Upload-Verträge, URL-Remapping, Backup der Binärdaten. | **offen** | B-Lauf (Pull) | Bezugsquelle für das Image = Betreiber-Entscheidung. | §1 (Storage), §3 (Dateien) |
| 9 | Realtime, Presence, Jobs | SSE entschieden (E6), nginx-Locations für Streams vorbereitet (`proxy_buffering off`), aber **kein Endpunkt**. Cron/Queue/Lease nicht vorhanden; nur der manuelle Wartungsendpunkt. | **offen** | B-Code | Reconnect-/Autorisierungs-/Cleanup-Tests fehlen. | §1 (Realtime), §2 (ingest-docs), §3 (Presence) |
| 10 | Mail, Push, iCal, Sitemap | Kein produktiver Mail-Adapter (O4); `LogMailSender` ist dev-only. VAPID, iCal, Sitemap/`robots.txt`, Newsletter-Secrets: nichts umgesetzt. | **offen** | B-Code | Resend-Key-Existenz (O4) und VAPID-Schlüssel ungeprüft. | §2, §3 (Push), §4 (robots, Sitemap) |
| 11 | Chatbot/RAG | Nichts umgesetzt. Stream-Vertrag E7 dokumentiert. Postgres-Image `pgvector/pgvector:pg17` gewählt, aber **keine** `CREATE EXTENSION vector`-Migration; Dimension/Modell-Kompatibilität (1024, HNSW) ungeprüft. | **offen** | B-Code | Embeddings-Übernahme vs. Neuindexierung nicht entschieden. | §2 (chatbot, ingest-*), §3 |
| 12 | Angular-Anbindung | Frontend unverändert auf Supabase: `@supabase/supabase-js` in `package.json`, **39** Quelldateien referenzieren den Supabase-Service bzw. -Client, 11 Zugriffe auf `environment.supabase`, Datenschutzseite nennt „Supabase Inc.“. Als offen geführt, kein verfrühtes Grün. | **offen** | B-Lauf (Greps) | Auth-Adapter kann nicht isoliert vorgezogen werden (siehe Kurzfazit). | §1, §3, §4 |
| 13 | Self-Hosting/Betrieb | Compose (dev + prod-Override), interne Netze, persistente Volumes, Migration-before-serve, Health, Graceful Shutdown (SIGTERM → Exit 0 in 0,3 s), Neustart mit Datenerhalt (`down`/`up` ohne `-v`), DB-Restore in neues Projekt: **belegt**. **Offen:** TLS, konfigurierte Origins/CORS, Upload- und Streaming-Erprobung, Restore inkl. Storage auf separatem System, RPO/RTO (O8), strukturierte Logs mit Request-IDs/Redaktion, Metriken/Alarme, Backend-Egress (K5), CI für Backend (der einzige Workflow baut/pusht nur das Frontend-Image), Betriebsdoku für Update/Rollback. | **teilweise** | B-Lauf | `docker-compose.prod.yml` bewusst nicht startbar (E16/O4). | §4 |
| 14 | Datenmigration und Cutover | Keine Export-/Import-Werkzeuge, kein Staging-Probelauf, kein Runbook; Supabase-Zugang nicht genutzt. | **offen** | B-Code | O8 (Fenster, RPO/RTO) offen. | §1, §4 |
| 15 | Tests/Pflichtnachweise | Siehe Tabelle unten. | **teilweise** | – | – | – |
| 16 | Erwartete Artefakte | (1) Matrix/Entscheidungen: ja (mit Korrekturen). (2) Backend: nur Auth; Angular-Adapter: keine. (3) Migrationswerkzeuge: keine. (4) Hosting-Setup: Compose ja, CI nein. (5) Bericht: dieses Dokument. (6) Runbook/Restore: Grundlagen. (7) Paritätsbericht: nicht möglich vor Abschluss. | **teilweise** | – | – | – |

### 3.1 Pflichtnachweise aus §15

| Nachweis | Stand | Beleg |
|---|---|---|
| Frontend-/Backend-Typecheck und Build | **belegt** | A2, A3 |
| Unit-/Contract-Tests | **belegt** (Auth-Umfang) | A1 |
| API-Integrationstests gegen echtes PostgreSQL | **teilweise** | 12 Port-Tests gegen PostgreSQL; Controller-Tests laufen noch gegen In-Memory-Ports, nicht gegen die DB |
| Migrations-Test (leere DB) | **belegt** | A4, A5 |
| Restore-Test | **teilweise** | §1.4 (nur DB, gleicher Host) |
| Vollständige E2E-Benutzerabläufe | **offen** | – (Frontend nicht angebunden) |
| Alle Auth-Flows inkl. fehlerhafter/abgelaufener Tokens, Refresh/Logout | **belegt** | §1.2; Abläufe/Parallelität in `db.integration.spec.ts` |
| Auth: Mehrfachorganisation, Kontenmigration | **offen** | – |
| Rechte-/Mandanten-Negativtests (Listen, Objekte, Joins, Exporte, Dateien, Realtime, Presence, RAG) | **offen** | – |
| Parallele Registrierungen/Slots/Votes, Jobs | **teilweise** | nur Token-Verbrauch und Rate-Limit-Upsert belegt |
| Dateien, Mail/Push, iCal/Zeitzonen, Sitemap, Chatstream, Indexierung | **offen** | – |
| Bestandsimport, Wiederaufnahme, Cutover-/Rollback-Probe | **offen** | – |
| Lasttests (Latenz, Indizes, Pool, lange Requests) | **offen** | Hinweis: `bcryptjs` läuft synchron und blockiert den Event-Loop pro Login (K12) |
| Start nach Containerneustart mit Daten | **belegt** | §1.2/A6 (Restart), `down`/`up` ohne `-v` |
| Lauf **ohne** Supabase-Verbindung (gesperrter Zugang) | **offen** | Backend selbst hat keine Supabase-Abhängigkeit (B-Code), der ausdrückliche Test mit gesperrtem Zugang fehlt und ist erst mit angebundenem Frontend aussagekräftig |
| Abschluss-Suche (keine aktive Supabase-Nutzung) | **offen** | Frontend/CI/Skripte nutzen Supabase noch |

---

## 4. Bewusste Abweichungen und ihre Tragfähigkeit

| ID | Abweichung | Bewertung | Begründung / Auflage |
|---|---|---|---|
| E16 | `LogMailSender` als dev-Transport, Produktion blockiert | **tragfähig mit Auflage** | Blocker belegt lokal und im Compose-Prod-Override (A8). Auflage: Die Sperre hängt allein an `NODE_ENV=production`; Image und Basis-Compose setzen `NODE_ENV` nicht und fixieren `MAIL_TRANSPORT: log`. Ein Betrieb **nur** mit der Basisdatei (z. B. Staging) schreibt Verifikations-/Reset-/Magic-Links samt Token ins Log (K3/K4). Produktiv immer mit Override betreiben und nach O4 den echten Adapter bereitstellen. |
| E13 | OpenAPI nur intern | **tragfähig nach Fix** | Vor dem Audit per Schreibweise umgehbar (M1). Jetzt doppelt abgesichert (Proxy case-insensitive blockiert, Backend case-sensitive). Hängt weiter an der Proxy-Konfiguration: Falls ein anderer Proxy (Coolify/Traefik) künftig direkt aufs Backend routet, wäre `/api/docs` offen. |
| E12 | Passwort-Mindestlänge 8 | **tragfähig, Lücke** | 7 Zeichen → 400 belegt. Es fehlt eine Obergrenze: bcrypt verwendet nur die ersten 72 Bytes (per Test belegt: ein 100-Zeichen-Passwort verifiziert mit den ersten 72 Zeichen). Obergrenze/Hinweis festlegen. |
| E14 | Rate-Limits 5/15 min Login, 3/h Mail, je E-Mail+IP | **tragfähig bei einem Proxy, Anpassungsbedarf** | Wirkung und Spoofing-Festigkeit belegt (A6). Offen: (1) Hinter einem **zusätzlichen** Proxy (z. B. Traefik vor nginx) sähe das Backend mit `trust proxy 1` nur dessen IP; der IP-Anteil des Schlüssels verschwindet, und Fremde könnten ein Konto 15 min lang sperren (aus dem Code abgeleitet, nicht getestet). (2) Kein globales Limit pro E-Mail gegen verteilte Angriffe. |
| E15 | Pool max. 10, Idle 30 s, Connect 5 s | **tragfähig** | Begrenzt und sauber geschlossen (Test), SIGTERM → Exit 0. Die Größe 10 ist ohne Lasttest nicht begründet. |
| E17 | Wartungsendpunkt mit Header-Token | **tragfähig, unvollständig** | 404 ohne/mit falschem Token, 204 mit Token belegt. Es gibt keinen Aufrufer (Cron kommt in Phase 3); bis dahin wachsen `verification_tokens`/`rate_limits`. Der Pfad ist über `/api/` extern adressierbar (nur durch Token geschützt); optional am Proxy sperren. |
| E18 | Fehlervertrag `{code,message}` | **tragfähig** | 400/401/403/404/429 im Compose belegt, auch für unbekannte Pfade. Nur die erste Validierungsmeldung wird geliefert. |
| O9 | MinIO hinter Profil `storage` | **tragfähig als Zwischenstand, blockiert** | Unverändert nicht pullbar (heute andere Fehlertexte als dokumentiert, siehe §3, Zeile 8). Kein Storage-Betrieb bis zur Entscheidung der Bezugsquelle. |
| E9 | `internal: true`-Netz für postgres/backend | **Anpassungsbedarf vor Phase 3** | Das Netz hat kein Gateway, das Backend kann deshalb **nicht ins Internet** (Resend/SMTP, Mistral, Web-Push-Endpunkte). Egress-Konzept nötig (neu als **O10** geführt). |
| E19 | Login erfordert bestätigte E-Mail; Link-Einlösung bestätigt die E-Mail (neu, vom Audit eingeführt) | **zur Bestätigung durch den Betreiber** | Ob das Bestandssystem „Confirm email“ aktiv hatte, ist ungeprüft (Dashboard-Einstellung). Die sicherere Variante ist umgesetzt. |

---

## 5. Fehlende Dinge, gruppiert

### 5a. Betreiber-Entscheidungen (blockierend)

| ID | Frage | Blockiert |
|---|---|---|
| **O4** Mail | Existiert der produktive `RESEND_API_KEY` und soll Resend weiterlaufen, oder nur SMTP? Prüfung im Supabase-Dashboard (Zugang vorhanden). | Produktiver Mail-Adapter ⇒ `docker-compose.prod.yml` startet erst danach; Einladungs-/Newsletter-/Benachrichtigungsmails |
| **O5** OAuth | Welche Provider (Google/GitHub/Discord) sind im Dashboard tatsächlich aktiv? **Aus dem Repo nicht beantwortbar**: `supabase/config.toml` enthält nur `[functions.ingest-docs]`, keine Auth-Konfiguration. | OAuth-Endpunkte, Identitäten-Import |
| **O9** MinIO | Bezugsquelle für `minio/minio`/`minio/mc` (Mirror, Eigen-Registry) oder Alternative (S3-kompatibel anderer Anbieter). | Storage-Modul, Binärdaten-Migration |
| **O8** Cutover | Wartungsfenster, RPO/RTO, Schreibstopp vs. Delta. | Phase 5/6 (später) |
| **O10** (neu) | Egress des Backends (internes Netz hat kein Gateway): welches Netz-/Proxy-Konzept? | Mail-Versand, Chatbot (Mistral), Web-Push |
| **E19** (neu) | Bestätigung der Login-Sperre für unbestätigte E-Mail (siehe §4). | – (umgesetzt, Rücknahme möglich) |
| Datenschutz/Impressum | Hosting-/Providerangaben für die Datenschutzseite (nennt noch „Supabase Inc.“); keine Angaben dürfen erfunden werden. | Veröffentlichung nach Cutover |

### 5b. Produktive Parität ungeprüft (Zugang vorhanden, Daten nicht geholt)

Nichts davon wurde gegen die Produktion geprüft; Zugangsdaten werden nicht im Chat ausgetauscht (O1).

- Echter **Schemaexport** und die tatsächlich installierten Migrationen (`schema_dump.sql` ist unbrauchbar, 77 Byte; `supabase_schema.sql` ist ein Update-Skript, kein Dump). Im Repo: 42 SQL-Migrationen + 1 `.patch`, `archive_migrations/` und `snippets/` leer.
- **`auth.users` inkl. Passwort-Hashes** (Export nur über Admin-Zugang), `auth.identities`; Annahme bcrypt `$2a$`/Kosten 10 nicht an echten Hashes geprüft.
- **Aktivierte Provider**, **„Confirm email“-Einstellung**, Mailvorlagen, Redirect-URLs (relevant für O5 und E19).
- **Storage-Inventar** `files`/`avatars` (Objektzahl, Größe, MIME, Checksummen) und Policies.
- **VAPID-Schlüssel** (privat) und `RESEND_API_KEY`-Existenz, Secrets-Namen der Edge Functions.
- **pg_cron-Schedules** (Zeitbasis/Zeitzone der täglichen Indexierung) und **Realtime-Publications**.
- **Dashboard-Webhooks**: Die Trigger `tr_feed_items_push_notify`/`tr_events_push_notify` legen nur Zeilen in `push_notification_queue` an. Wer `send-push` und `send-event-notification` aufruft, steht nicht im Repo; auch `send-guest-invitation` hat im Frontend **keinen** Aufrufer (`inviteGuest` legt nur eine Zeile an).
- **`verify_jwt` je Edge Function**: Nur `ingest-docs` ist in `config.toml` mit `verify_jwt = false` erfasst, und der Code prüft keinen Header (öffentlich aufrufbar). Für die übrigen Funktionen ist die Einstellung ungeprüft.
- **Zählwerte**: 115 `CREATE POLICY`-Statements, 73 `DROP POLICY`, eindeutig nach Name+Tabelle etwa 51; 26 eindeutige Funktionen, 19 Trigger. Die bisher genannten „101 Policies / 25 Funktionen / 17 Trigger“ sind so **nicht reproduzierbar**. Verbindlich nur per Replay der Migrationen auf PostgreSQL bzw. Live-Schema.

### 5c. Restarbeit je Phase

- **Phase 1 Rest:** Membership-Kontext (`GET /api/v1/me/memberships`-Äquivalent von `get_user_memberships`), OrgGuard, Rechte-Matrix (aus wirksamen Policies, siehe Replay-Empfehlung), Mandanten-Negativtests gegen echtes PostgreSQL; Einladungs-/Kontoflüsse (`send-invitation` check-email, `invite-member`, `generate-magic-link`, `delete-auth-user`); OAuth nach O5. Querschnitt, früh sinnvoll weil jedes Modul erbt: Request-IDs/strukturierte Logs/Redaktion, CORS (Capacitor-Origin), Passwort-Obergrenze, asynchrones Hashing.
- **Phase 2:** fachliche Module in der Reihenfolge aus `00-status.md` (organizations → … → presence/notifications/push), je Modul Guard + Negativtests + Parallelitätstests.
- **Phase 3:** iCal, Newsletter/Event-Mail-Jobs, Push, Chatbot-Stream + Ingest, Sitemap/robots.txt, SSE, Cron mit Lease, Egress (O10), Aufrufer für den Wartungsendpunkt.
- **Phase 4:** Frontend-Umstellung (39 Dateien, `@supabase/supabase-js`, `environment`, `scripts/set-env.js`, `generate-sitemap.js`, `robots.txt`, Datenschutz, PWA/Capacitor-Update-Plan).
- **Phase 5:** Export-/Import-/Validierungswerkzeuge (DB, Auth, Storage) mit Manifest/Dry-Run/Checkpoints, Staging-Probelauf, vollständiger Restore auf separatem System.
- **Phase 6:** Cutover-Runbook, Smoke-Tests, Rollback-Frist; Stilllegung erst nach Freigabe.
- **Querschnitt:** Lasttests, Nachweis mit gesperrtem Supabase-Zugang, CI (Backend-Tests, `tsc`, Compose-Smoke; heutiger Workflow baut nur das Frontend-Image), TLS, Beobachtbarkeit/Alarme, Abschluss-Suche.

### 5d. Hausarbeiten des aktuellen Stands

**Beobachtungen aus dem Audit (ohne Codeänderung, nach Wichtigkeit):**

| ID | Beobachtung | Empfehlung |
|---|---|---|
| K1 | `frontend` hat keinen Compose-Healthcheck (`docker compose ps` zeigt `Up`, nicht `healthy`); `selfhosting.md` behauptete das Gegenteil (korrigiert). | Healthcheck auf nginx `/health` (existiert). |
| K2 | `/health/readiness` über nginx extern liefert 200 vom **statischen** `location /health`-Prefix (kein DB-Bezug). Ein externes Monitoring bekäme falsches Grün. | Externes Monitoring auf `/health` (nginx) bzw. interne Readiness getrennt behandeln. |
| K3 | Der dev-Transport schreibt Magic-/Reset-/Verifikationslinks samt Token ins Backend-Log, in **jeder** Umgebung mit `MAIL_TRANSPORT=log`. | Mit O4 ablösen. |
| K4 | E16-Sperre hängt nur an `NODE_ENV`. | Siehe §4 E16. |
| K5 | Backend ohne Egress (internes Netz ohne Gateway). | O10 klären. |
| K6 | `@types/node ^26.6.5` bei Laufzeit Node 22.23; kein `engines`-Feld, keine `.nvmrc`. | Typen auf `^22` pinnen, `engines` setzen. |
| K7 | `InMemoryRateLimiter` liegt in `backend/src/auth/` und wird mitkompiliert (nicht verdrahtet). | Nach `backend/test/` verschieben. |
| K8 | `MIGRATIONS_DATABASE_URL` nicht in der Startvalidierung. | Optional ergänzen. |
| K9 | Rate-Limit-IP hinter zusätzlichem Proxy (siehe E14). | Vor Produktivtopologie entscheiden (`trust proxy` anpassen). |
| K10 | Kein CORS konfiguriert (nur same-origin über nginx). | Mit Capacitor/Frontend-Phase. |
| K11 | Ein Frontend-Test (`mikrotask`/`feed`) greift real aufs Netz („fetch failed“ im stderr); die Tests bestehen trotzdem. | Netzwerk im Test mocken. |
| K12 | `bcryptjs` hasht/prüft synchron (`hashSync`/`compareSync`) und blockiert den Event-Loop. | Port auf asynchrone Variante umstellen, bevor Lasttests laufen. |
| K13 | Lokale Supabase-CLI-Volumes (`supabase_db_pulsedeck`, `supabase_edge_runtime_pulsedeck`, `supabase_storage_pulsedeck`) liegen noch in Docker (nicht von Compose; unangetastet). | Nach Abschluss aufräumen. |
| K14 | `docker compose config` löst Secrets in Klartext auf. | Nur mit `--quiet` oder gefiltert verwenden. |

**Commit-Struktur für den unkommittierten Arbeitsbaum** (Stand zu Beginn des Audits: 13 geänderte, 1 gelöschte Datei, 8 neue Pfade; durch die Audit-Korrekturen kommen `.dockerignore` sowie die Änderungen in `backend/` und `docs/` hinzu; `.env` ist per `.gitignore` ausgeschlossen, ebenso `backend/dist` und `backend/node_modules`, geprüft mit `git check-ignore`). Vorschlag:

1. `chore(rules)`: `.agents/rules/*`, `skills-lock.json`, `.agents/skills/ponytail/` (Vitest-Anpassung, Skill).
2. `test(frontend)`: die sechs reparierten Specs und `src/testing/` (Bestandsfehler-Reparatur).
3. `refactor(frontend)`: Löschung `features/organizations/create-organization.component.ts` (O7).
4. `feat(backend)`: `backend/` (Auth-Service/Controller/Guard, Config, Postgres-Ports, Migrationen, Tests); optional in zwei Commits (Auth-Kern / Postgres+HTTP).
5. `feat(ops)`: `docker-compose*.yml`, `docker/`, `.env.example`, `nginx.conf`, `.dockerignore`, `.gitignore`.
6. `docs(migration)`: `docs/`.

**Laufende Container:** Haupt-Stack `pulsedeck-*` (Port 8080 → Frontend; Postgres/Backend nur intern) läuft auf dem Stand **nach** den Audit-Korrekturen. `pulsedeck-pg-test` (Port 127.0.0.1:5433) wird von `npm test` benötigt (`scripts/test-db-setup.mjs` startet ihn bei Bedarf). Die Audit-Projekte sind entfernt. Auf dem Host laufen weitere, fremde Container (andere Projekte), die nicht angefasst wurden.

---

## 6. Empfohlene nächste Schritte

Ohne Betreiber-Entscheidung startbar, in dieser Reihenfolge:

1. **Arbeitsbaum committen** (Struktur oben). Der Stand ist grün und die Korrekturen sind verifiziert; ein sauberer Verlauf macht Phase 1 nachvollziehbar.
2. **Phase 1 Rest mit Replay-Grundlage:** Supabase-Migrationen auf einer Vanilla-PostgreSQL mit minimalem `auth`-Stub einspielen, daraus die **tatsächlich wirksamen** Policies/Funktionen/Trigger auslesen und die Rechte-Matrix bauen, dann Membership-Kontext, OrgGuard und Mandanten-Negativtests. Begründung: Auftrag §16 verlangt Auth und Autorisierung vor fachlichen Endpunkten, und das Replay löst gleichzeitig das Zählwert-Problem (§5b). Es braucht keinen Produktionszugang.
3. **Querschnitt früh nachziehen:** Request-IDs/strukturierte Logs mit Redaktion, asynchrones Hashing, Passwort-Obergrenze, Frontend-Healthcheck, `@types/node`-Pin. Alles erbt später jedes Modul, deshalb jetzt billiger als später.
4. **CI einrichten** (Backend: `npm ci`, `tsc`, `npm test` mit PostgreSQL-Service; Frontend: Build/Test; Compose-Smoke). Heute gibt es keine automatische Absicherung der 76 Backend-Tests.
5. **Produktions-Parität holen** (Betreiber führt Exporte aus bzw. stellt Zugang bereit): Schema, `auth.users`, Provider, „Confirm email“, Mailvorlagen, Storage-Inventar, VAPID, Cron, Webhooks. Das beantwortet O5 und liefert die Basis für O4, E19 und die Importwerkzeuge.
6. **Betreiber-Entscheidungen einholen** (parallel zu 2–4): O4, O5, O9, O10, E19. O4 und O10 blockieren Phase 3, O9 das Storage-Modul.
7. **Phase 2 Module** in der Reihenfolge der Frontend-Abhängigkeit. **Frontend-Auth erst zusammen mit den Datenmodulen umstellen**, weil Supabase unsere JWTs nicht akzeptiert und alle Datenzugriffe an der Supabase-Session hängen. Eine frühe reine Auth-Umstellung würde das Frontend lahmlegen.

---

## 7. Gates am Ende dieses Prüflaufs (2026-10-13 21:39)

| Gate | Ergebnis |
|---|---|
| `cd backend && npm test` | **grün**: 12 Dateien / 76 Tests, Exit 0 |
| `cd backend && npx tsc --noEmit` | **grün**, Exit 0 |
| `cd backend && npm run build` | **grün**, Exit 0 |
| Frontend `npm run build` | **grün**, Exit 0 (nur Budget-/ESM-Warnungen) |
| Frontend `npm test -- --watch=false` | **grün**: 7 Dateien / 8 Tests, Exit 0 |

**Fehlschläge in diesem Prüflauf:** Keine Gate-Fehlschläge am Ende. Während des Laufs rot und inzwischen behoben: M1–M4 (siehe §1.3). Unbehoben, weil außerhalb des Auftrags oder Betreiber-Entscheidung: K1–K14, O4/O5/O8/O9/O10, alle offenen Abschnitte aus §3.

---

## 8. Nachtrag 2026-10-14 (Folgearbeiten nach Freigabe)

### 8.1 Korrektur und zwei weitere Mängel

Dieser Bericht hat unter §1.2/§2 „Enumeration-Gleichheit belegt“ geschrieben. Das war unvollständig: Verglichen wurden nur die **Antworten**, nicht die **Antwortzeit**, obwohl der Folgeauftrag „keine Enumeration über Timing/Antwort“ fordert. Beim Einbau der echten Mail-Transporte fiel der Unterschied auf und wurde gemessen:

| ID | Mangel | Messung / Reproduktion | Regressionsnachweis | Behebung |
|---|---|---|---|---|
| **M5** | Kontoenumeration über die Antwortzeit | Login unbekannte E-Mail **0 ms** gegen bekannte E-Mail mit falschem Passwort **54 ms** (bcrypt nur im zweiten Fall); Signup neu 55 ms gegen bestehend 0 ms; Magic-Link/Reset bekannt 29 ms gegen unbekannt 7,5 ms; bei SMTP-Ausfall dauerte die Antwort für bekannte Konten bis zum Timeout (~10 s). | `auth.timing-equalization.spec.ts` (deterministisch: Hash-Schritt in beiden Fällen), `templated-mail.sender.spec.ts` (Antwort wartet nicht auf den Transport), `auth.controller.enumeration.spec.ts` (Mindestdauer); Messung danach 58 gegen 53 ms und 54 gegen 53 ms, im Stack Reset 211–222 gegen 209–210 ms | Platzhalter-Hash bei unbekannter E-Mail, Hash vor dem Lookup beim Signup, asynchroner Mailversand, Mindestdauer `AUTH_MIN_RESPONSE_MS` (Standard 200 ms) auf Signup/Magic-Link/Reset (E25) |
| **M6** | Login-Rate-Limit durch Schreibweise umgehbar | Der Limit-Schlüssel nutzte die E-Mail wie getippt (`A@x.org` ≠ `a@x.org`), die Datenbank ist case-insensitiv: sechster Versuch mit anderer Schreibweise lieferte 401 statt 429. | `auth.controller.enumeration.spec.ts` Rot (401 statt 429), danach Grün; Stack: 5×401, dann 429 bei wechselnder Schreibweise | E-Mail-Adressen werden vor Validierung und Limit getrimmt und kleingeschrieben (DTO-Transform) |

Mit M5/M6 fällt auch die Aussage in §4 zu E14 („wirksam und nicht per X-Forwarded-For umgehbar“) enger aus: Die Spoofing-Festigkeit galt, die Umgehung per Schreibweise bestand.

### 8.2 Statusänderungen gegenüber diesem Bericht

| Punkt | war | jetzt |
|---|---|---|
| §3 Zeile 3 Bestandsaufnahme | Zählwerte nicht reproduzierbar | reproduzierbar per Replay des Live-Dumps aus Git `0d4978f`: 32 Tabellen, 126+7 Policies, 24 Funktionen, 14 Trigger (`04-rechte-matrix.md`); Basisschema fehlt im Repo, Push-Tabellen fehlen im Dump; produktive Parität weiter unbelegt |
| §3 Zeile 5 Auth | Mail nur dev-Transport | SMTP und Resend implementiert; Link-Vertrag trägt den Zweck (`type=`); Kontoverknüpfung per bestätigter E-Mail; offen: Einladungsflüsse, OAuth, Import, realer Anbieter-Versand |
| §3 Zeile 6 Autorisierung | **offen** | **teilweise**: Membership-Kontext, OrgGuard, Resolver, lesende Endpunkte mit Negativtests gegen echtes PostgreSQL; Rechte-Matrix als Vorschlag (`04-…`, D1–D8 offen); schreibende Operationen und alle Fachmodule offen |
| §3 Zeile 7 Datenbank | nur Auth-Tabellen | + `organizations`, `organization_roles`, `members` (Migration 000005) |
| §3 Zeile 10 Mail | offen | teilweise (Adapter ja, Anbieterwahl/realer Versand offen) |
| §3 Zeile 13 Betrieb | CI/Request-IDs/Logs offen | CI-Workflow und Compose-Smoke-Skript vorhanden (Workflow noch nicht auf GitHub gelaufen), Request-ID und JSON-Zugriffslog, Frontend-Healthcheck, Egress-Netz; weiter offen: TLS, Metriken/Alarme, Restore auf separatem System, RPO/RTO |
| §5a O4 | blockierend | teilweise gelöst (Anbieterwahl und Zugangsdaten offen) |
| §5a O10 | offen | Standard umgesetzt (Egress-Netz nur für das Backend), Bestätigung/Allowlist offen |
| §5a O9 | offen | unverändert; Alternativen verifiziert (SeaweedFS, RustFS, Zenko) |
| §5a E19 | Bestätigung offen | Betreiber ließ nach Rückfrage fortfahren, ausdrückliche Bestätigung steht aus |
| K1 Frontend ohne Healthcheck | offen | erledigt |
| K5 Backend ohne Egress | offen | erledigt (O10-Standard) |
| K6 `@types/node ^26` | offen | erledigt (Typen 22.20.5, `engines`) |
| K7 In-Memory-Limiter in `src/` | offen | erledigt (nach `test/` verschoben) |
| E12 keine Passwort-Obergrenze | Lücke | 72-Byte-Obergrenze für neue Passwörter (Signup/Reset/Änderung) |
| K2, K3, K4, K8–K11, K13, K14 | offen | unverändert (K3/K4: `log`-Transport nur noch Entwicklung, Prod-Override verlangt `MAIL_TRANSPORT`) |
| neu K15 | – | `AppModule` ist ein flaches Modul; mit dem zweiten Fachmodul in Nest-Module aufteilen (Datenbank, Auth, Tenancy) |
| neu K16 | – | `bcryptjs` läuft synchron und blockiert den Event-Loop pro Hash (≈ 55 ms); vor Lasttests auf eine asynchrone/native Variante umstellen (K12 bleibt offen) |
| neu K17 | – | `npm audit --omit=dev`: 2 moderate Meldungen (`js-yaml` über `@nestjs/swagger`, relevant nur beim Parsen der OpenAPI, die intern bleibt); kein Fix ohne Breaking Change |

### 8.3 Gates (2026-10-14)

| Gate | Ergebnis |
|---|---|
| `cd backend && npm test` | **grün**: 24 Dateien / 157 Tests |
| `cd backend && npx tsc --noEmit` / `npm run build` | grün / grün |
| Frontend `npm run build` / `npm test -- --watch=false` | grün / 7 Dateien, 8 Tests |
| `bash scripts/smoke-compose.sh` | „Smoke bestanden“ (20 Prüfungen) |

## 9. Nachtrag 2026-10-14 — Stand nach Phase 2–6

Der Abgleich oben bezieht sich auf den Stand nach Phase 1. Seitdem sind Phase 2 (Fachmodule), 3 (Edge-Function-Ersatz), 4 (Frontend), 5 (Migrationswerkzeuge) und 6 (Cutover-Plan) umgesetzt; Nachweise und Gates stehen in `00-status.md`, der Betriebsablauf in `../betrieb/migration.md`. Die Aussage „produktive Parität nicht belegt“ gilt unverändert: **nichts davon wurde gegen die Produktion ausgeführt.**

### 9.1 In dieser Phase gefundene und behobene Mängel

| # | Mangel | Wie gefunden | Behebung (Regressionsnachweis) |
|---|---|---|---|
| N1 | Frontend baute in einem sauberen Checkout nicht: `environment.ts`/`environment.prod.ts` waren per `.gitignore` ausgeschlossen (CI und Docker-Build hätten gescheitert) | Frischer `git clone` + `npm run build` | Dateien versioniert (enthalten nur die API-Basis) |
| N2 | `npm ci` scheiterte nach dem Sicherheits-Update (Peer-Pakete fehlten im Lockfile) | Frischer Klon | Lockfile mit `npm install` neu erzeugt; `npm ci` grün |
| N3 | Native Apps hätten die API nicht erreicht: relative Adresse `/api/v1` im Capacitor-Ursprung, kein CORS | Prüfung gegen Auftrag §12 | `build:mobile` + `CORS_ORIGINS` (`cors.spec.ts`, per Mutation geprüft) |
| N4 | Formular sendete `next_meeting: ''` bzw. leere optionale Fremdschlüssel → 400 | Browser-Test gegen die echte API | DTO toleriert leeres `next_meeting`; Frontend bildet leere Werte auf `null` ab (`api-payloads.spec.ts`) |
| N5 | `npm run build` scheiterte (`Duplicate identifier 'require'`), obwohl `tsc --noEmit` grün war | Build in den Gates | Umbenannt; Build gehört zum Gate |
| N6 | Realtime-Client verband sich bei neuen Tabellen nicht neu | Test | behoben, Test `realtime.service.spec.ts` |
| N7 | Backend-Image lief als root bzw. war für `node` nicht lesbar | Compose-Smoke | `chmod`, `USER node` (Smoke prüft „nicht als root“) |
| N8 | Zweifacher `X-Content-Type-Options` (nginx + Backend) | Compose-Smoke | `proxy_hide_header` |
| N9 | Flaky `db.integration.spec` (Pool-Teardown, fremde Tokens) und Absturzrisiko bei Verbindungsverlust im Leerlauf | wiederholte Läufe | Pool-`error`-Listener (Test rot→grün), Tests auf eigene Daten beschränkt |
| N10 | DB-Teardown der Test-Datenbanken überschritt unter Last 10 s | volle Suite | `hookTimeout` 60 s, drei grüne Läufe |
| N11 | Sicherheitsmeldungen in Abhängigkeiten (Angular XSS, Capacitor kritisch, vitest kritisch) | `npm audit` | Patch-Updates im bestehenden Bereich; Rest in O15 |

Nach dem ersten Zugriff auf die Produktion (nur lesend, `05-produktionsbefund.md`) kamen hinzu:

| # | Mangel | Wie gefunden | Behebung |
|---|---|---|---|
| N12 | Export hätte alle Dateien als „fehlend“ gemeldet: `files.storage_path` beginnt in Produktion mit `/`, Objektnamen nicht | Pfadmuster-Abfrage gegen Produktion | Führende Schrägstriche entfernt, Ausbruch aus dem Bucket bleibt gesperrt (zwei Tests, Mutationen erkannt) |
| N13 | Export brach bei `feed_item_reads` ab, das es in Produktion nie gab (Juli-Migration nicht eingespielt); `feed_items.is_pinned` fehlt ebenfalls | Spaltenabdruck Produktion gegen Replay | Tabelle optional, Fixture in Produktionsform; Import mit Spaltenstandard |
| N14 | Tabellen, die in der Quelle existieren, aber der Registry fehlen, wären still weggefallen | Review beim Bau des Abzugswerkzeugs | Export bricht mit `SCHEMA_DRIFT` ab (`--allow-unmapped`) |
| **N15** | **Nicht im Repo geführte, öffentlich aufrufbare Edge Function in Produktion** (Altlast; Details nur lokal) | Liste der bereitgestellten Funktionen gegen das Repo | **akzeptiert bis zur Stilllegung (O20)** |

| **N16** | **`docker-compose.prod.yml` war seit Commit `a16ab6d` ungültig** (Doppelpunkt in der Pflichtmeldung zu `SECRETS_ENCRYPTION_KEY`, YAML-Fehler): ein Produktions-Deploy damit wäre gescheitert, kein Test hatte es bemerkt | Beim Prüfen der neuen Coolify-Datei | Meldung korrigiert; `scripts/check-compose.sh` prüft alle Varianten (Gültigkeit, Pflichtwerte, keine Ports/Netze beim Coolify-Stack) und läuft in der CI |

### 9.2 Weiterhin offen (Zusammenfassung; Quelle: `02-entscheidungen-offene-fragen.md`)

Betreiberentscheidungen: O4 (echter Mailanbieter), O5/O18 (OAuth), O8 (Fenster, RPO/RTO), O11/E27 (Rechte-Standards bestätigen), O12 (Hosting-Text der Datenschutzerklärung), O19 (Release des Backend-Images); Bestätigungen E19, E21, E26 (Datei-Volume statt MinIO). Technisch/Prüfung: O13 (Produktions-Probelauf der Migration), O14 (Gerätetest), O15 (`xlsx`, `js-yaml`), O16 (CSP), O17 (PDF-Verarbeitung im Prozess). Funktional offen: Selbst-Löschung des eigenen Kontos, Opt-out aus dem Newsletter. K12 und K16 (synchrones `bcryptjs`, Lasttests) bleiben offen; K15 (`AppModule` aufteilen) ist erledigt.

