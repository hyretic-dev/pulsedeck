#!/usr/bin/env bash
# Startet eine lokale Kopie des migrierten Produktionsstands aus einem Export (siehe docs/betrieb/migration.md §3) in einem
# eigenen Compose-Projekt – getrennt von jedem anderen Projekt. Es verlässt nichts den Rechner: Mail-Transport `log`
# (Links stehen im Backend-Log), Hintergrundjobs aus (kein Newsletter, kein Push, keine Outbox), keine KI-Schlüssel.
#
#   bash scripts/local-copy.sh start <exportverzeichnis> [--platform-admin <uuid>]...   (legt an, importiert, validiert, startet)
#   bash scripts/local-copy.sh stop                                                     (hält an, Daten bleiben)
#   bash scripts/local-copy.sh reset                                                    (löscht Projekt, Volumes und Zugangsdatei)
#
# Port: LOCAL_COPY_PORT (Standard 8090). Die Zugangsdatei backups/lokal.env (Wegwerf-Secrets) ist git-ignoriert.
set -euo pipefail
cd "$(dirname "$0")/.."
umask 077

PROJEKT="pulsedeck-lokal"
ENV_DATEI="backups/lokal.env"
PORT="${LOCAL_COPY_PORT:-8090}"
compose() { docker compose -p "$PROJEKT" --env-file "$ENV_DATEI" "$@"; }
git check-ignore -q backups/ || { echo "backups/ ist nicht git-ignoriert – Abbruch (Personendaten)"; exit 2; }

BEFEHL="${1:-}"; shift || true
case "$BEFEHL" in
  stop)
    compose stop; echo "Angehalten (Daten bleiben). Neu starten: bash scripts/local-copy.sh start <export>"; exit 0 ;;
  reset)
    compose down -v 2>/dev/null || true; rm -f "$ENV_DATEI"; echo "Projekt $PROJEKT samt Volumes und $ENV_DATEI entfernt."; exit 0 ;;
  start) ;;
  *) echo "Usage: $0 start <exportverzeichnis> [--platform-admin <uuid>]... | stop | reset"; exit 2 ;;
esac

EXPORT="${1:-}"; shift || true
[ -n "$EXPORT" ] && [ -f "$EXPORT/manifest.json" ] || { echo "Exportverzeichnis mit manifest.json fehlt"; exit 2; }
EXPORT="$(cd "$EXPORT" && pwd)"
git check-ignore -q "$EXPORT/" || { echo "$EXPORT ist nicht git-ignoriert – Abbruch"; exit 2; }

if [ ! -f "$ENV_DATEI" ]; then
  mkdir -p backups
  cat >"$ENV_DATEI" <<ENV
POSTGRES_PASSWORD=$(openssl rand -hex 16)
POSTGRES_MIGRATIONS_PASSWORD=$(openssl rand -hex 16)
POSTGRES_RUNTIME_PASSWORD=$(openssl rand -hex 16)
JWT_SECRET=$(openssl rand -hex 32)
JWT_ISSUER=pulsedeck
JWT_AUDIENCE=pulsedeck-web
APP_BASE_URL=http://localhost:${PORT}
FRONTEND_PORT=${PORT}
SECRETS_ENCRYPTION_KEY=$(openssl rand -base64 32)
MAIL_TRANSPORT=log
JOBS_ENABLED=false
ENV
  echo "Zugangsdatei $ENV_DATEI angelegt (Wegwerf-Secrets)."
fi

echo "== Stack starten ($PROJEKT, Port $PORT) =="
compose up -d --build --wait >/dev/null 2>&1 || { echo "FEHLER beim Start"; compose logs --tail 40; exit 1; }

BEFUELLT="$(compose exec -T postgres psql -U pulsedeck_admin -d pulsedeck -Atc 'select count(*) from auth_users' | tr -d '\r')"
if [ "$BEFUELLT" = "0" ]; then
  echo "== Import aus $EXPORT =="
  ARBEIT="$(mktemp -d backups/.import-XXXXXX)"
  cp -a "$EXPORT/." "$ARBEIT/" && chmod -R a+rwX "$ARBEIT"
  cli() { compose run --rm --no-deps -T --entrypoint node -v "$PWD/$ARBEIT:/export" backend dist/migration/cli.js "$@"; }
  cli import --from /export "$@"
  cli validate --from /export
  rm -rf "$ARBEIT"
else
  echo "== Import übersprungen: Datenbank enthält bereits $BEFUELLT Konten (für Neuanfang: reset) =="
fi

echo
echo "Läuft: http://localhost:${PORT}"
echo "Anmelden mit dem Produktionspasswort (Hashes sind übernommen) oder über „Passwort vergessen“: der Link steht im Log:"
echo "  docker compose -p $PROJEKT --env-file $ENV_DATEI logs backend | grep -o 'http[^ ]*token=[^ ]*' | tail -1"
