# Self-Hosting: Compose-Stack (Stand 2026-10-14)

Stack: `docker-compose.yml` (dev/local) + `docker-compose.prod.yml` (Produktiv-Overrides). Dienste: PostgreSQL (pgvector/pg17), NestJS-Backend, Angular/Nginx-Frontend (die Anwendung) und die statische Website (`website/`, Astro: Startseite, Handbuch, Impressum, Datenschutz). Dateien liegen im Docker-Volume `files-data` (E26, kein MinIO). Optional (Entwicklung): `mailpit`.

## Starten

```bash
cp .env.example .env          # Werte setzen (JWT_SECRET z. B. mit: openssl rand -hex 32)
docker compose up -d --build  # postgres, backend, frontend, website
docker compose ps             # alle vier müssen (healthy) sein
```

- PostgreSQL hat **keinen** öffentlichen Port; das Backend nur im internen Netz. Nur das Backend hängt zusätzlich im Netz `egress` (ausgehender Zugriff für Mail, Mistral, Web-Push; O10), Postgres nicht.
- Frontend veröffentlicht `${FRONTEND_PORT:-8080}:80`; nginx routet `/api/` ans Backend, SPA-Fallback danach.
- Website veröffentlicht `${WEBSITE_PORT:-8081}:80`. `APP_BASE_URL` ist die Adresse der Anwendung: die Website verlinkt dorthin (beim Bauen eingetragen) und leitet alte Anwendungsadressen dorthin weiter. `SITE_URL` (optional) ist die Adresse der Website selbst (kanonische URLs, Sitemap). Das Handbuch liegt als Markdown mit Frontmatter in `website/src/content/handbook/`.
- Backend-Health: `/health/liveness` (Prozess lebt) und `/health/readiness` (DB-Ping) — nur intern erreichbar, Compose-Healthcheck nutzt readiness. Hinweis: Über nginx extern liefert `/health/readiness` 200 aus dem **statischen** nginx-`/health`-Block (Coolify-Healthcheck), nicht vom Backend; extern daher nur `/health` für die Frontend-Erreichbarkeit verwenden. Der Frontend-Dienst hat seit 2026-10-14 einen Compose-Healthcheck auf `/health`.
- Migration-before-serve: der Backend-Entrypoint (`backend/docker-entrypoint.sh`) führt `node-pg-migrate -d MIGRATIONS_DATABASE_URL up` mit der Migrations-Rolle aus; schlägt das fehl, startet der Server nicht.
- Rollen-Trennung: `docker/postgres/10-roles.sh` legt `pulsedeck_migrations` (DDL) und `pulsedeck_runtime` (nur DML, Grants aus Migration `000004`) an.

## Mail (O4)

`MAIL_TRANSPORT` wählt den Versand (Werte in `.env`, Vorlage `.env.example`):

| Wert | Verhalten | Pflichtvariablen |
|---|---|---|
| `log` | schreibt Verifikations-/Magic-/Reset-Links **samt Token ins Backend-Log**; nur Entwicklung, in der Produktion gesperrt | – |
| `smtp` | Versand über nodemailer; mit `SMTP_USER`/`SMTP_PASSWORD` wird STARTTLS erzwungen (kein Klartext-Fallback), `SMTP_SECURE=true` oder Port 465 = implizites TLS | `MAIL_FROM`, `SMTP_HOST` (+ `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`) |
| `resend` | Versand über die Resend-HTTP-API | `MAIL_FROM`, `RESEND_API_KEY` |

`docker-compose.prod.yml` setzt `NODE_ENV=production` und **verlangt** `MAIL_TRANSPORT` (smtp oder resend). Zustellfehler werden geloggt (ohne Link/Token/Empfänger), die API antwortet unverändert 202 (keine Kontoenumeration, E24). Realer Versand mit echtem Anbieter ist noch **nicht** getestet; SMTP wurde gegen einen echten Test-Server (`smtp-server` im Test, Mailpit im Compose) geprüft, Resend gegen eine simulierte API.

Lokaler SMTP-Test mit Mailpit (Profil `dev-mail`, nur intern erreichbar):

```bash
MAIL_TRANSPORT=smtp SMTP_HOST=mailpit SMTP_PORT=1025 MAIL_FROM='PulseDeck <noreply@pulsedeck.local>' \
  docker compose --profile dev-mail up -d
docker compose exec backend wget -qO- http://mailpit:8025/api/v1/messages     # eingegangene Mails
```

## Reproduzierbarer Smoke

```bash
bash scripts/smoke-compose.sh     # isoliertes Projekt, leere Volumes, Wegwerf-Secrets, räumt auf
```

Prüft Start mit leeren Volumes, Healthchecks, Auth-Ablauf inkl. Rotation/Logout, Mandanten-Endpunkte ohne Anmeldung, gesperrte OpenAPI (auch per Schreibweise), Token-freies nginx-Log, die Fachfunktionen durch den Proxy (Organisation, Termine, Beiträge, Dateien inkl. Download-Header, Echtzeit, iCal, Sitemap, Chat/Push ohne Konfiguration), unprivilegierten Backend-Prozess, Login und Datei nach Backend-Neustart und die schreibgeschützte Abnahme (`READ_ONLY`). Dieselbe Prüfung läuft im CI-Job `compose-smoke`.

Weitere Nachweise, jeweils auch in CI: `e2e/browser-smoke.mjs` (echte Oberfläche im Headless-Chromium: Registrierung, E-Mail-Bestätigung, alle Seiten, Anlegen-Dialoge, Upload, Passwort-Login; Job `browser-smoke`, Beschreibung `e2e/README.md`).

## Logs und Request-ID

Das Backend schreibt je Anfrage **eine JSON-Zeile** (`time`, `requestId`, `method`, `path` ohne Query, `status`, `durationMs`, `userId` aus dem verifizierten Token). Query-Strings, Header, Bodies und IP-Adressen werden nicht geloggt. nginx vergibt `$request_id`, reicht ihn als `X-Request-Id` ans Backend und loggt ihn als `rid=…`, so lassen sich Proxy- und Backend-Zeilen korrelieren. Der Wert wird im Antwort-Header `X-Request-Id` zurückgegeben.

Für Coolify gibt es eine eigene Compose-Datei und Anleitung: `docs/betrieb/coolify.md` (`docker-compose.coolify.yml`).

## Konfiguration im Überblick

Alle Werte stehen in `.env.example` (nie Secrets einchecken). Ergänzend zu den Pflichtwerten oben:

| Bereich | Variablen | Hinweis |
|---|---|---|
| Geheimnisse | `SECRETS_ENCRYPTION_KEY` (32 Bytes Base64/Hex) | In der Produktion Pflicht. Verschlüsselt das SMTP-Passwort je Organisation; Schlüssel verloren = Passwörter neu eingeben |
| Hintergrundarbeit | `JOBS_ENABLED`, `JOBS_TICK_SECONDS`, `APP_TIMEZONE` | Mail-Outbox, Push, Newsletter-Zeitplan, Wissensaufträge, Wartung laufen im Backend-Prozess; bei mehreren Instanzen auf allen `true` (Claims über `scheduler_state`) |
| Newsletter/SMTP je Organisation | `SMTP_ALLOW_PRIVATE_HOSTS` | Standard `false`: Ziele in privaten Netzen werden abgelehnt (SSRF-Schutz) |
| Web-Push | `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` | Leer = Push aus. Schlüssel erzeugen: `npx web-push generate-vapid-keys`; neue Schlüssel = Geräte melden sich neu an |
| Dateien | `FILES_DIR` (`/data/files`, Volume `files-data`), `MAX_UPLOAD_MB` (25) | Volume in die Datensicherung (unten) |
| KI | `MISTRAL_API_KEY`, `DOCS_FILE` | Ohne Schlüssel antworten Chat und Indexierung mit 503; `DOCS_FILE` ist das mitgelieferte Handbuch: ein Verzeichnis mit Markdown-Dateien (Frontmatter `title`, `order`; Standard im Image `/app/handbook`, Quelle `website/src/content/handbook/`) oder eine einzelne Markdown-Datei |
| Echtzeit | `REALTIME_ENABLED` | SSE `GET /api/v1/orgs/:orgId/realtime`; nginx puffert diesen Pfad und `/chat` nicht |
| Native Apps | `CORS_ORIGINS` | Exakte Ursprünge, kommagetrennt; leer = nur gleicher Ursprung (E36) |
| Schreibgeschützter Betrieb | `READ_ONLY` (Frontend-Container) | `true` weist schreibende API-Aufrufe mit 503 ab; Login bleibt möglich |

Sitemap und `robots.txt` der Anwendung liefert das Backend (nginx proxyt `/sitemap.xml` und `/robots.txt`); die Adresse der Instanz stammt aus `APP_BASE_URL`. Die Sitemap enthält Anmeldung, Registrierung und die öffentlichen Seiten der Organisationen; `robots.txt` sperrt `/api/`, `/auth/` und die internen Bereiche (`/*/dashboard`). Die Website (`website/`) hat eine eigene Sitemap unter `/sitemap.xml`.

Der Compose-Stack **braucht keine zweite Komponente für Dateien**: Uploads gehen als Multipart an das Backend, das sie unter `<orgId>/<fileId>` im Volume ablegt (UUIDs, kein Pfad vom Client); Downloads laufen über das Backend mit Rechteprüfung (E26).

## OpenAPI

`/api/docs` (UI) und `/api/docs-json` existieren am Backend; der Reverse Proxy blockt sie extern (404, case-insensitive — `/api/DOCS-json` war bis zum Audit 2026-10-13 erreichbar, siehe E20; das Backend routet zusätzlich case-sensitive). Intern erreichbar per `docker compose exec backend wget -qO- http://127.0.0.1:3000/api/docs-json`.

## Auth-Smoke (manuell, per curl durch den nginx)

```bash
# Registrierung (202 erwartet; Mail-Transport 'log' schreibt den Link ins Backend-Log)
curl -s -X POST http://localhost:8080/api/v1/auth/signup \
  -H 'Content-Type: application/json' -d '{"email":"smoke@example.org","password":"sicher1234"}'

# Verifikations-Token aus Backend-Log (dev-Transport, bis O4 geklärt ist)
TOKEN=$(docker compose logs backend 2>/dev/null | sed 's/\x1b\[[0-9;]*m//g' \
  | grep -o 'token=[A-Za-z0-9_-]*' | tail -1 | cut -d= -f2 | tr -d '\r\n')

# E-Mail verifizieren → Session (200, userId/accessToken/refreshToken)
VERIFY=$(curl -s -X POST http://localhost:8080/api/v1/auth/verify-email \
  -H 'Content-Type: application/json' -d "{\"token\":\"$TOKEN\"}")

# Login → 200; Refresh (Rotation) → 200; Logout (Bearer + Refresh im Body) → 204
curl -s -X POST http://localhost:8080/api/v1/auth/login -H 'Content-Type: application/json' \
  -d '{"email":"smoke@example.org","password":"sicher1234"}'
curl -s -X POST http://localhost:8080/api/v1/auth/refresh -H 'Content-Type: application/json' \
  -d "{\"refreshToken\":\"$(echo "$VERIFY" | python3 -c 'import json,sys; print(json.load(sys.stdin)["refreshToken"])')\"}"
```

Nachweis der Ausführung (2026-10-13): Signup 202 → Verify 200 (UUID userId) → Login 200 → Refresh 200 → Logout 204 → Refresh danach 401 `session_invalid`; Login nach Backend-Neustart weiterhin 200 (Daten erhalten). Wartungsendpunkt: ohne Token 404, mit `X-Maintenance-Token` 204.

Zusätzlich im Audit (2026-10-13, frisches Compose-Projekt):

- Login **vor** der Verifikation → 403 `email_not_verified` (E19); Verify-Token erneut → 401 `link_invalid`.
- Refresh mit bereits rotiertem Token → 401 `session_invalid`.
- Magic-Link: `POST /api/v1/auth/magic-link` 202 → `POST /api/v1/auth/magic-link/consume` mit dem Token aus dem Backend-Log 200 → erneut 401 `link_invalid`; Einlösen bestätigt die E-Mail.
- Passwort-Reset: `POST /api/v1/auth/password-reset` 202 → `…/password-reset/consume` (Body `token`, `newPassword`) 200 → altes Passwort 401, neues 200; `POST /api/v1/auth/change-password` (Bearer) 200.
- Login-Rate-Limit: fünf falsche Versuche 401, danach 429 (auch mit gefälschtem `X-Forwarded-For`).
- Proxy: `curl -s -o /dev/null -w '%{http_code}' http://localhost:8080/api/DOCS-json` muss **404** liefern (ebenso `/api/Docs`, `/api/docs-JSON`).
- Log-Hygiene: `docker compose logs frontend | grep 'token='` darf nach einem Aufruf von `/auth/callback?token=x` keinen Treffer liefern.
- Graceful Shutdown: `docker stop` des Backends → Exit-Code 0 in unter 1 s.

## Migrationen (manuell, mit Migrations-Rolle)

```bash
cd backend
MIGRATIONS_DATABASE_URL='postgres://pulsedeck_migrations:<pw>@postgres-host:5432/pulsedeck' npm run migration:up
# Rückrollen: npm run migration:down (eine Migration pro Aufruf; `down 0` rollt alle zurück)
```

## Backup / Restore

Eine vollständige Sicherung besteht aus **Datenbank und Datei-Volume** — ein DB-Dump allein genügt nicht — sowie der `.env` (Secrets, `SECRETS_ENCRYPTION_KEY`, `JWT_SECRET`, VAPID-Schlüssel) an einem getrennten, geschützten Ort.

```bash
# DB-Backup (custom format, wiederherstellbar mit pg_restore)
docker compose exec -T postgres pg_dump -U pulsedeck_admin -Fc pulsedeck > backup-$(date +%F).pgdump

# Dateien sichern (Volume files-data; Projektname = Verzeichnisname, hier pulsedeck)
docker run --rm -v pulsedeck_files-data:/data:ro -v "$PWD":/backup alpine \
  tar czf /backup/files-$(date +%F).tar.gz -C /data .

# DB-Restore in eine neue, leere Datenbank (als Superuser: legt pgvector an; Eigentümer und Rechte stammen aus dem Dump)
docker compose exec -T postgres psql -U pulsedeck_admin -d postgres -c 'CREATE DATABASE pulsedeck_restore OWNER pulsedeck_migrations'
docker compose exec -T postgres pg_restore -U pulsedeck_admin -d pulsedeck_restore --exit-on-error < backup-2026-xx-xx.pgdump

# Dateien zurückspielen (in ein leeres Volume)
docker run --rm -v pulsedeck_files-data:/data -v "$PWD":/backup alpine tar xzf /backup/files-2026-xx-xx.tar.gz -C /data
```

**Belegt (2026-10-14):**

- *Dateien:* Archiv aus dem Volume gezogen und in ein frisches Volume entpackt, alle 7 Objekte mit identischer SHA-256.
- *Plain-SQL-Variante der Datenbank* (ältere Anleitung, `pg_dump | gzip` → `psql`): im Audit 2026-10-13 in ein neues Projekt eingespielt, Prüfsumme der Nutzerdaten identisch, Logins funktionieren.

Grenzen: Die Proben liefen auf einem Host mit kleinen synthetischen Datenmengen — keine RTO-Aussage; Aufbewahrung, RPO/RTO und ein regelmäßiger automatischer Zeitplan sind Betreiber-Entscheidungen. Eine Wiederherstellung auf einem **anderen** Host (Netz, DNS, Secrets neu) wurde nicht geprobt.
