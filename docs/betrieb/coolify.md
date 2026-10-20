# Betrieb auf Coolify

Produktivbetrieb mit Coolify (Build Pack „Docker Compose“) auf Grundlage von `docker-compose.coolify.yml`: eine einzige Datei,
**keine veröffentlichten Ports, keine eigenen Netze, keine Bind-Mounts** (Coolify baut in einem Hilfscontainer; ein Bind-Mount
zeigte dort ins Leere). `NODE_ENV=production`; Pflichtwerte werden beim Start der Dienste geprüft, nicht beim Build.

> **Stand 2026-10-16:** Live unter `https://pulsedeck.de` (Ressource „pulsedeck-nestjs“, Branch `main`). Lokal prüfbar mit
> `bash scripts/check-compose.sh` und `SMOKE_COMPOSE_FILE=docker-compose.coolify.yml bash scripts/smoke-compose.sh`.

## 1. Ressource

1. *New Resource* → **Docker Compose** aus dem Git-Repository, Branch `main`, *Base Directory* `/`,
   **Docker Compose Location `/docker-compose.coolify.yml`**.
2. **Auto-Deploy bewusst wählen:** Mit Auto-Deploy geht jeder Push auf `main` sofort live. Außerdem veröffentlicht
   `.github/workflows/docker-release.yml` bei jedem Push auf `main` ein Frontend-Image nach Docker Hub.
3. **Domains nur an `frontend` und `website`** eintragen, jeweils Port 80:
   - `frontend` (die Anwendung): `https://app.pulsedeck.de`
   - `website` (Startseite, Handbuch, Impressum, Datenschutz): `https://pulsedeck.de,https://www.pulsedeck.de`

   `postgres` und `backend` bekommen **keine** Domain. Coolify bietet die Domain-Felder für alle Dienste an; landet die Domain bei
   `postgres`, leitet Traefik dorthin und die Seite antwortet mit **502 Bad Gateway**. Kontrolle: die Labels der Container
   (`docker inspect <frontend> --format '{{json .Config.Labels}}' | grep -o 'Host([^)]*)'`). Für `app.pulsedeck.de` braucht es einen
   DNS-Eintrag (A/CNAME) auf denselben Server.
4. Eine Domain kann nur an einer Ressource hängen: vorher bei der alten Ressource entfernen (Coolify meldet sonst einen Konflikt).

## 2. Umgebungsvariablen

**Jede Variable auf „Runtime only“** (kein Build-Time-Häkchen), sonst landen Geheimnisse als Build-Argumente im Image-Verlauf. Im
Deploy-Log erscheint ohnehin „Added N ARG declarations“ für Coolify-eigene Werte (z. B. `SOURCE_COMMIT`); entscheidend ist, dass bei
keinem Geheimnis das Häkchen gesetzt ist. Werte nie in den Chat oder ins Repo.

**Pflicht** (fehlt eine, bricht der Start mit lesbarer Meldung ab):

| Variable | Wert |
|---|---|
| `POSTGRES_PASSWORD`, `POSTGRES_MIGRATIONS_PASSWORD`, `POSTGRES_RUNTIME_PASSWORD` | je `openssl rand -hex 24` (drei verschiedene) |
| `JWT_SECRET` | `openssl rand -hex 32` |
| `APP_BASE_URL` | `https://app.pulsedeck.de` (die Anwendung; einzige Basis für Links in Mails, Sitemap, Kalender; die Website verlinkt und leitet alte Adressen hierhin weiter) |
| `MAIL_TRANSPORT`, `MAIL_FROM`, `SMTP_*` | IONOS: `smtp`, `PulseDeck <mailer@pulsedeck.de>`, `SMTP_HOST=smtp.ionos.de`, `SMTP_PORT=587`, `SMTP_SECURE=false`, `SMTP_USER=mailer@pulsedeck.de`, `SMTP_PASSWORD` als Secret. Alternativ `resend` + `RESEND_API_KEY` |
| `SECRETS_ENCRYPTION_KEY` | `openssl rand -base64 32`, **verloren = SMTP-Passwörter der Organisationen neu eingeben**; getrennt sichern |

**Optional:** `SITE_URL` (Adresse der Website, Standard `https://pulsedeck.de`; nur bei anderer Domain), `MISTRAL_API_KEY` (Chat und Wissensbasis, sonst 503), `VAPID_PUBLIC_KEY`/`VAPID_PRIVATE_KEY`/`VAPID_SUBJECT` (Push;
`npx web-push generate-vapid-keys`), `CORS_ORIGINS` (native Apps), `MAINTENANCE_TOKEN`, `MAX_UPLOAD_MB`, `APP_TIMEZONE`,
Rate-Limits (`.env.example`). `READ_ONLY=true` sperrt schreibende API-Aufrufe (503, Login bleibt möglich), `JOBS_ENABLED=false`
schaltet Newsletter, Push und Mail-Outbox ab, beides nur für Wartung oder Abnahme.

## 3. Deployment und Prüfung

*Deploy* auslösen. Der Backend-Entrypoint migriert mit der Migrations-Rolle, bevor der Server startet (schlägt das fehl, startet
nichts). Erwartung: `postgres`, `backend`, `frontend`, `website` **healthy**; `https://app.pulsedeck.de/health` → 200, `/api/docs` → 404,
`https://app.pulsedeck.de/robots.txt` nennt `https://app.pulsedeck.de/sitemap.xml`; `https://pulsedeck.de/` zeigt die Startseite,
`https://pulsedeck.de/robots.txt` nennt `https://pulsedeck.de/sitemap.xml`.

| Fehlerbild | Ursache |
|---|---|
| `backend` unhealthy Sekunden nach dem Start | Konfiguration unvollständig: z. B. `SMTP_USER` ohne `SMTP_PASSWORD`, `SECRETS_ENCRYPTION_KEY` nicht 32 Bytes, `APP_BASE_URL` ohne `https://`. Meldung unter *Logs* des Dienstes `backend` |
| `password authentication failed for user pulsedeck_migrations` | Das Daten-Volume wurde ohne die Rollen initialisiert. Das Rollen-Skript läuft nur beim ersten Start eines **leeren** Volumes (`docker/postgres/Dockerfile`) |
| 502 Bad Gateway auf der Domain | Domain hängt am falschen Dienst (siehe §1.3) |
| Domain-Konflikt beim Speichern | Domain ist noch einer anderen Ressource zugeordnet |

### Überwachung von außen (Uptime Kuma)

Der Prüfpunkt `GET https://app.pulsedeck.de/api/v1/public/health` läuft durch die ganze Kette (Proxy, Backend, Datenbank) und
antwortet ohne Anmeldung mit `200 {"status":"ok"}`, bei nicht erreichbarer Datenbank mit `503` (ohne Fehlerdetails; die stehen im
Backend-Log). Der nginx-Pfad `/health` prüft dagegen nur den Webserver selbst, deshalb nicht dafür verwenden.

Monitore in Uptime Kuma (jeweils HTTP(s), Intervall 60 s, Wiederholungen 2):

| Monitor | URL | Erwartung |
|---|---|---|
| App und API | `https://app.pulsedeck.de/api/v1/public/health` | Status 200, Schlüsselwort `ok` |
| Website | `https://pulsedeck.de/health` | Status 200 |
| Zertifikat | beide Domains | Ablauf-Warnung 14 Tage vorher |

Der Server mit Uptime Kuma sollte nicht derselbe sein wie der von PulseDeck, sonst fällt die Überwachung mit dem Ausfall aus.

### Umzug von `pulsedeck.de` auf `app.pulsedeck.de`

Bis zur Trennung lieferte `pulsedeck.de` die Anwendung aus. Danach gilt:

- **Neu anmelden:** Die Sitzung liegt im `localStorage` der alten Adresse und geht nicht auf `app.pulsedeck.de` über. Mitglieder
  melden sich einmal neu an (Magic Link). Vorher ankündigen.
- **Alte Adressen bleiben nutzbar:** Die Website leitet `/login`, `/registrieren`, `/auth/callback?…` (bereits verschickte
  Anmelde-Links), `/event/…` und `/<kürzel>…` (öffentliche Seiten der Organisationen) mit 301 an die Anwendung weiter. Der Query-String
  mit dem Token wird dabei nicht protokolliert (Log-Format `ohne_query` in `website/nginx.conf.template`).
- **Alter Service-Worker:** Browser mit der alten App-Installation holen `ngsw-worker.js` neu; die Website liefert dort einen
  Safety-Worker, der sich abmeldet, und beantwortet `ngsw.json` mit 404. Bis dahin leitet `/api/` der Website temporär an das
  Frontend der Anwendung. Beides (Safety-Worker, `/api/`-Block, `ngsw.json`) kann nach einigen Monaten aus `website/` entfernt werden.
- **Search Console:** `app.pulsedeck.de` als neue Property anlegen und die Sitemap `https://app.pulsedeck.de/sitemap.xml` einreichen;
  für `pulsedeck.de` gilt `https://pulsedeck.de/sitemap.xml`. Nach jedem Deploy mit neuen Seiten: `cd website && node scripts/indexnow.mjs`
  (meldet die Sitemap per IndexNow an Bing und andere). Die Verifizierungsdatei der Website liegt unter `website/public/`.
- **Native Apps:** `cd app && PULSEDECK_API_URL=https://app.pulsedeck.de npm run build:mobile`, `CORS_ORIGINS` unverändert.
- **E-Mails:** Mailvorlagen und Kalender-Links nutzen `APP_BASE_URL`, zeigen also automatisch auf die Anwendung.

## 4. Datensicherung

Coolify-eigene Datenbank-Backups gelten nur für von Coolify verwaltete Datenbanken, **nicht** für den Postgres-Dienst dieser
Compose-Ressource. Auf dem Server sichern (Containernamen enthalten den Deploy-Zeitstempel, daher per Filter suchen):

```bash
P=$(docker ps --filter "name=postgres-<ressource>" --format '{{.Names}}' | head -1)
docker exec "$P" pg_dump -U pulsedeck_admin -Fc pulsedeck > backup-$(date +%F).pgdump
docker run --rm -v <ressource>_files-data:/data:ro -v "$PWD":/backup alpine tar czf /backup/files-$(date +%F).tar.gz -C /data .
```

**Eingerichtet (2026-10-17):** `/root/pulsedeck-backups/backup.sh` per Root-Cron täglich 03:15 UTC (Datenbank + Datei-Volume, Dump wird
mit `pg_restore --list` geprüft, Aufbewahrung 14 Tage, Protokoll `backup.log`). Die Sicherungen liegen auf **demselben Server**; eine
Kopie außerhalb (z. B. Hetzner Storage Box) hat der Betreiber am 2026-10-20 als aktiviert gemeldet (Einrichtung hier ergänzen).

Volume-Namen mit `docker volume ls` prüfen. Restore: `selfhosting.md` („Backup / Restore“). Die Umgebungsvariablen (vor allem
`SECRETS_ENCRYPTION_KEY`) getrennt und geschützt sichern.

## 5. Offen

SPF/DKIM der Domain prüfen (Zustellbarkeit); juristische Prüfung der Datenschutzerklärung (O12);
Restore auf dem Zielserver proben.

## 6. Pilotbetrieb: Demo-Organisation und Kennzahlen

**Demo-Organisation „Ortsverband Musterstadt“** für Workshops und Gespräche (erfundene Personen, Adressen auf `.invalid`, Termine relativ
zum heutigen Tag). Das Konto muss vorher normal registriert und bestätigt sein; es wird Admin der Demo.

```bash
B=$(docker ps --filter "name=backend-<ressource>" --format '{{.Names}}' | head -1)
docker exec -e DATABASE_URL="$DATABASE_URL" "$B" node dist/demo/seed-demo.main.js --owner du@example.de            # anlegen
docker exec -e DATABASE_URL="$DATABASE_URL" "$B" node dist/demo/seed-demo.main.js --owner du@example.de --reset    # neu anlegen (vor jedem Workshop)
```

`DATABASE_URL` ist die Verbindung der Laufzeit-Rolle (steht in der Umgebung des Backend-Containers, nicht ausgeben). Kürzel `demo-ortsverband`
(über `--slug` änderbar); die öffentliche Seite liegt unter `https://app.pulsedeck.de/demo-ortsverband`.

**Kennzahlen-Report** (nur lesend, nur Zähler je Organisation, keine Personendaten): `scripts/kpi-report.sql`, einmal pro Woche.

```bash
P=$(docker ps --filter "name=postgres-<ressource>" --format '{{.Names}}' | head -1)
docker exec -i "$P" psql -U pulsedeck_admin -d pulsedeck -f - < scripts/kpi-report.sql
```

Im Skript stehen die Kürzel der internen Organisationen (Demo, „PulseDeck Piloten“), die nicht mitzählen (`\set intern`).

**Plattform-Admin:** Das Konto braucht `auth_users.is_platform_admin = true` (einmalig per SQL setzen). Danach erscheint in der Seitenleiste
das *Feedback-Board* (Meldungen, Themen nach Zahl der Organisationen, Herkunft und Pilot-Anfragen neuer Organisationen).
