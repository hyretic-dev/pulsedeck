# Deployment auf Coolify

Anleitung für den Produktivbetrieb mit Coolify (Build Pack „Docker Compose“) und die Datenübernahme aus Supabase. Grundlage ist
`docker-compose.coolify.yml`: eine einzige Datei, **keine veröffentlichten Ports und keine eigenen Netze** (Coolify legt das Netz an
und leitet die Domain auf `frontend`), `NODE_ENV=production`, Pflichtwerte ohne Standard.

> **Stand:** Die Compose-Datei ist lokal geprüft (`bash scripts/check-compose.sh`; vollständiger Smoke mit
> `SMOKE_COMPOSE_FILE=docker-compose.coolify.yml bash scripts/smoke-compose.sh`; Start im echten Produktionsmodus: gesund, Backend läuft
> als `node`, keine Host-Ports). **In Coolify selbst wurde noch nichts ausgeführt** — Bezeichnungen in der Oberfläche können abweichen.

## 0. Voraussetzungen (vor dem ersten Deploy abhaken)

| # | Voraussetzung | Stand |
|---|---|---|
| 1 | Mailanbieter festgelegt (IONOS-Postfach `mailer@pulsedeck.de`) und ein realer Testversand erfolgt (`log` ist in der Produktion gesperrt) | Anbieter gewählt, **Testversand offen (O4)**; zusätzlich SPF/DKIM der Domain `pulsedeck.de` bei IONOS prüfen (Zustellbarkeit) |
| 2 | Echte Datei-Bytes (Bucket `files`) gespiegelt, sonst kommen die 9 Dateien nur als Platzhalter | **offen** (S3-Schlüssel, `scripts/prod-mirror/`) |
| 3 | Produktions-Export frisch gezogen (`--only-org <org-slug>`), Probelauf bestanden | Probelauf mit Stand 2026-10-14 bestanden (89/89) |
| 4 | Login mit dem Produktionspasswort in der lokalen Kopie (`scripts/local-copy.sh`) geprüft | **offen (Betreiber)** |
| 5 | Domain und DNS (TLS übernimmt Coolify/Traefik), Wartungsfenster, Ansage an die Nutzer | **offen (O8)** |
| 6 | Hosting-Angaben in der Datenschutzerklärung | **offen (O12)** |
| 7 | GitHub-CI auf dem Branch grün (erster Lauf steht aus) | **offen** |

## 1. Ressource in Coolify anlegen

1. Neues Projekt/Environment → *New Resource* → **Docker Compose** (aus Git-Repository, GitHub-App oder Deploy-Key).
2. Repository `hyretic-dev/pulsedeck`, Branch `main` (zum Üben ein Branch), *Base Directory* `/`, **Docker Compose Location `/docker-compose.coolify.yml`**.
3. **Auto-Deploy / Webhook zunächst ausschalten.** Jeder Push auf `main` würde sonst sofort neu deployen; außerdem veröffentlicht
   `.github/workflows/docker-release.yml` bei jedem Push auf `main` ein Frontend-Image nach Docker Hub (`…/lexion`) — für Coolify mit
   Build aus dem Repo nicht nötig, aber ein Auslöser, den man kennen muss.
4. Dienst **`frontend`**: Domain eintragen (`https://<domain>`, der Dienst lauscht auf Port 80). Für `postgres` und `backend` **keine** Domain.

## 2. Umgebungsvariablen (Coolify → Environment Variables)

**Pflicht** (fehlt eine, scheitert der Start mit einer lesbaren Meldung):

| Variable | Wert |
|---|---|
| `POSTGRES_PASSWORD`, `POSTGRES_MIGRATIONS_PASSWORD`, `POSTGRES_RUNTIME_PASSWORD` | je `openssl rand -hex 24` (drei verschiedene) |
| `JWT_SECRET` | `openssl rand -hex 32` |
| `APP_BASE_URL` | endgültige Adresse mit `https://`, z. B. `https://app.example.org` (einzige erlaubte Basis für Links in Mails) |
| `MAIL_TRANSPORT` | `smtp` oder `resend` |
| `MAIL_FROM` und je nach Transport `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD` (`SMTP_SECURE`) bzw. `RESEND_API_KEY` | vom Mailanbieter. **Gewählt: IONOS-Postfach `mailer@pulsedeck.de`** — `MAIL_TRANSPORT=smtp`, `MAIL_FROM=PulseDeck <mailer@pulsedeck.de>` (Absender muss dem Postfach entsprechen), `SMTP_HOST=smtp.ionos.de`, `SMTP_PORT=587` (STARTTLS; mit Zugangsdaten erzwingt das Backend TLS), `SMTP_SECURE=false`, `SMTP_USER=mailer@pulsedeck.de`, `SMTP_PASSWORD` **als Secret markieren** (Coolify: Variable → „Is Secret“/verborgen). Die Servereinstellungen stammen aus der IONOS-Hilfe und sind mit dem Testversand zu bestätigen |
| `SECRETS_ENCRYPTION_KEY` | `openssl rand -base64 32` — **verloren = gespeicherte SMTP-Passwörter der Organisationen neu eingeben** |

**Für die Abnahme zunächst setzen:** `READ_ONLY=true` (schreibende API-Aufrufe → 503, Login bleibt möglich) und `JOBS_ENABLED=false`
(kein Newsletter, kein Push, keine Outbox). Beides beim Go-live zurücknehmen (siehe §5).

**Optional:** `VAPID_PUBLIC_KEY`/`VAPID_PRIVATE_KEY`/`VAPID_SUBJECT` (Push; `npx web-push generate-vapid-keys`), `MISTRAL_API_KEY` (Chat und
Wissensbasis, sonst 503), `CORS_ORIGINS` (native Apps), `MAINTENANCE_TOKEN`, `MAX_UPLOAD_MB`, `APP_TIMEZONE`, Rate-Limit-Werte
(Standardwerte siehe `.env.example`). `JWT_ISSUER`/`JWT_AUDIENCE` haben Standardwerte (`pulsedeck`/`pulsedeck-web`).

**Jede Variable auf „Runtime only“ stellen** (kein Build-Time-Häkchen). Coolify reicht Variablen sonst als Build-Argumente an den Docker-Build
weiter (im Deploy-Log: „Added N ARG declarations“); Geheimnisse stünden dann im Image-Verlauf. Die Werte nie in den Chat oder ins Repo.

## 3. Erstes Deployment

*Deploy* auslösen. Der Backend-Entrypoint führt die Migrationen mit der Migrations-Rolle aus, bevor der Server startet (schlägt das fehl,
startet nichts). Erwartung: `postgres`, `backend`, `frontend` **healthy**; `https://<domain>/health` liefert `healthy`, die
OpenAPI-Oberfläche (`/api/docs`) ist von außen 404.

**Fehlerbild „backend unhealthy“ schon Sekunden nach dem Start:** die Konfiguration ist unvollständig oder ungültig, das Backend bricht mit einer
lesbaren Meldung ab. Häufig: `SMTP_USER` gesetzt, aber `SMTP_PASSWORD` leer (die Meldung nennt es), `SECRETS_ENCRYPTION_KEY` nicht 32 Bytes,
`APP_BASE_URL` ohne `https://`. Meldung in Coolify unter *Logs* des Dienstes `backend` ablesen.

## 4. Daten übernehmen (nur in eine leere Datenbank, einmalig)

Export auf dem Rechner mit Zugang zur Produktion (siehe `docs/betrieb/migration.md` §3 und `scripts/prod-mirror/README.md`):

```bash
LEGACY_DATABASE_URL=… node backend/dist/migration/cli.js export --out backups/export-<datum> \
  --storage-dir backups/prod-<zeit>/storage --only-org <org-slug>
scp -r backups/export-<datum> <server>:/tmp/export        # Personendaten: danach auf dem Server löschen
```

Auf dem Server (Coolify-Container-Namen mit `docker ps` prüfen):

```bash
B=$(docker ps --filter "name=backend" --format '{{.Names}}' | head -1)
docker cp /tmp/export "$B":/tmp/export && docker exec -u root "$B" chown -R node:node /tmp/export
PLATTFORM_ADMIN=<Konto-ID>   # einziger Plattform-Administrator (E27 D1), Wert siehe lokale Notiz
docker exec "$B" node dist/migration/cli.js import --from /tmp/export --dry-run --platform-admin $PLATTFORM_ADMIN
docker exec "$B" node dist/migration/cli.js import --from /tmp/export --platform-admin $PLATTFORM_ADMIN
docker exec "$B" node dist/migration/cli.js validate --from /tmp/export
docker exec -u root "$B" rm -rf /tmp/export && rm -rf /tmp/export
```

Die Umgebung des Containers liefert `MIGRATIONS_DATABASE_URL`, `FILES_DIR` und `SECRETS_ENCRYPTION_KEY`. Exit-Codes und Wiederaufnahme: `migration.md` §3/§4.
`validate` muss „Validierung erfolgreich“ melden; jede rote Zeile ist ein Abbruchgrund.

## 5. Abnahme und Go-live

1. **Abnahme mit `READ_ONLY=true`** (nur lesen, Login möglich): Anmeldung mit einem echten Konto, je Rolle die Hauptseiten, Dateiabruf,
   öffentliche Seite, `sitemap.xml` — Liste in `migration.md` §5/§6. Schreiben liefert 503 `read_only`.
2. **Freigabe:** `READ_ONLY=false` und `JOBS_ENABLED` entfernen bzw. `true` setzen, *Redeploy*; Domain/DNS umschalten, falls noch nicht geschehen;
   Mail-Testversand (z. B. „Passwort vergessen“ an eine eigene Adresse).
3. **Sofort danach ein Backup ziehen** (Ausgangspunkt nach der Freigabe).
4. Beobachtungsfrist und Abbruchkriterien: `migration.md` §6/§8. **Rollback nach der Freigabe verliert neue Daten** — Entscheidung nur vor der Freigabe.

## 6. Datensicherung

Die Coolify-eigenen Datenbank-Backups gelten für von Coolify verwaltete Datenbanken, **nicht** für den Postgres-Dienst innerhalb dieser
Compose-Ressource. Deshalb auf dem Server (z. B. per Cron) sichern — Befehle und Restore-Beleg in `selfhosting.md` („Backup / Restore“):

```bash
P=$(docker ps --filter "name=postgres" --format '{{.Names}}' | head -1)
docker exec "$P" pg_dump -U pulsedeck_admin -Fc pulsedeck > backup-$(date +%F).pgdump
docker run --rm -v <ressource>_files-data:/data:ro -v "$PWD":/backup alpine tar czf /backup/files-$(date +%F).tar.gz -C /data .
```

Den Volume-Namen (`<ressource>_files-data`) mit `docker volume ls` prüfen. Dazu die Umgebungsvariablen (vor allem `SECRETS_ENCRYPTION_KEY`) getrennt und geschützt sichern.

## 7. Offen / nicht in Coolify geprobt

Alle Coolify-Schritte (Ressource, Domain-Zuordnung, Variablen, Persistenz der Volumes, Auto-Deploy), der Mailversand, die echten Datei-Bytes,
die Erreichbarkeit der Container-Namen für `docker exec` und ein Restore auf dem Zielserver. Beim ersten Durchlauf bitte Abweichungen hier eintragen.
