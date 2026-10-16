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
3. **Domains nur am Dienst `frontend`** eintragen (`https://pulsedeck.de,https://www.pulsedeck.de`, Port 80). `postgres` und
   `backend` bekommen **keine** Domain. Coolify bietet die Domain-Felder für alle Dienste an; landet die Domain bei `postgres`,
   leitet Traefik dorthin und die Seite antwortet mit **502 Bad Gateway**. Kontrolle: die Labels des Frontend-Containers
   (`docker inspect <frontend> --format '{{json .Config.Labels}}' | grep -o 'Host([^)]*)'`).
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
| `APP_BASE_URL` | `https://pulsedeck.de` (einzige Basis für Links in Mails, Sitemap, Kalender) |
| `MAIL_TRANSPORT`, `MAIL_FROM`, `SMTP_*` | IONOS: `smtp`, `PulseDeck <mailer@pulsedeck.de>`, `SMTP_HOST=smtp.ionos.de`, `SMTP_PORT=587`, `SMTP_SECURE=false`, `SMTP_USER=mailer@pulsedeck.de`, `SMTP_PASSWORD` als Secret. Alternativ `resend` + `RESEND_API_KEY` |
| `SECRETS_ENCRYPTION_KEY` | `openssl rand -base64 32` — **verloren = SMTP-Passwörter der Organisationen neu eingeben**; getrennt sichern |

**Optional:** `MISTRAL_API_KEY` (Chat und Wissensbasis, sonst 503), `VAPID_PUBLIC_KEY`/`VAPID_PRIVATE_KEY`/`VAPID_SUBJECT` (Push;
`npx web-push generate-vapid-keys`), `CORS_ORIGINS` (native Apps), `MAINTENANCE_TOKEN`, `MAX_UPLOAD_MB`, `APP_TIMEZONE`,
Rate-Limits (`.env.example`). `READ_ONLY=true` sperrt schreibende API-Aufrufe (503, Login bleibt möglich), `JOBS_ENABLED=false`
schaltet Newsletter, Push und Mail-Outbox ab — beides nur für Wartung oder Abnahme.

## 3. Deployment und Prüfung

*Deploy* auslösen. Der Backend-Entrypoint migriert mit der Migrations-Rolle, bevor der Server startet (schlägt das fehl, startet
nichts). Erwartung: `postgres`, `backend`, `frontend` **healthy**; `https://pulsedeck.de/health` → 200, `/api/docs` → 404,
`/robots.txt` nennt `https://pulsedeck.de/sitemap.xml`.

| Fehlerbild | Ursache |
|---|---|
| `backend` unhealthy Sekunden nach dem Start | Konfiguration unvollständig: z. B. `SMTP_USER` ohne `SMTP_PASSWORD`, `SECRETS_ENCRYPTION_KEY` nicht 32 Bytes, `APP_BASE_URL` ohne `https://`. Meldung unter *Logs* des Dienstes `backend` |
| `password authentication failed for user pulsedeck_migrations` | Das Daten-Volume wurde ohne die Rollen initialisiert. Das Rollen-Skript läuft nur beim ersten Start eines **leeren** Volumes (`docker/postgres/Dockerfile`) |
| 502 Bad Gateway auf der Domain | Domain hängt am falschen Dienst (siehe §1.3) |
| Domain-Konflikt beim Speichern | Domain ist noch einer anderen Ressource zugeordnet |

## 4. Datensicherung

Coolify-eigene Datenbank-Backups gelten nur für von Coolify verwaltete Datenbanken, **nicht** für den Postgres-Dienst dieser
Compose-Ressource. Auf dem Server sichern (Containernamen enthalten den Deploy-Zeitstempel, daher per Filter suchen):

```bash
P=$(docker ps --filter "name=postgres-<ressource>" --format '{{.Names}}' | head -1)
docker exec "$P" pg_dump -U pulsedeck_admin -Fc pulsedeck > backup-$(date +%F).pgdump
docker run --rm -v <ressource>_files-data:/data:ro -v "$PWD":/backup alpine tar czf /backup/files-$(date +%F).tar.gz -C /data .
```

Volume-Namen mit `docker volume ls` prüfen. Restore: `selfhosting.md` („Backup / Restore“). Die Umgebungsvariablen (vor allem
`SECRETS_ENCRYPTION_KEY`) getrennt und geschützt sichern.

## 5. Offen

Regelmäßiges, automatisches Backup mit Aufbewahrung; realer Mail-Testversand über IONOS (SPF/DKIM der Domain prüfen); Hosting-Angaben in
der Datenschutzerklärung (O12); Restore auf dem Zielserver geprobt.
