#!/usr/bin/env bash
# Probelauf der Datenmigration auf isoliertem Staging (eigenes Compose-Projekt, Wegwerf-Secrets, leere Volumes):
#   Probelauf → Import → Validierung → Backup (pg_dump + Dateikopie) → Restore in frische Datenbank → Validierung des Restores.
# Nutzt die Migrationswerkzeuge aus dem Backend-Image, also genau das, was später im Cutover läuft.
#
#   bash scripts/rehearse-migration.sh <exportverzeichnis> [weitere Import-Argumente, z. B. --platform-admin <uuid>]
#
# Das Exportverzeichnis erzeugt `migrate:export` (siehe docs/betrieb/migration.md). Exit 0 nur, wenn alles stimmt.
set -u
cd "$(dirname "$0")/.."

EXPORT="${1:-}"
[ -d "$EXPORT" ] && [ -f "$EXPORT/manifest.json" ] || { echo "Usage: $0 <exportverzeichnis mit manifest.json> [Import-Argumente]"; exit 2; }
EXPORT="$(cd "$EXPORT" && pwd)"
shift

PROJEKT="pulsedeck-rehearsal-$$"
ENV_DATEI="$(mktemp)"
ARBEIT="$(mktemp -d)"
FEHLER=0
PW_ADMIN="$(openssl rand -hex 12)"; PW_MIG="$(openssl rand -hex 12)"; PW_RT="$(openssl rand -hex 12)"
cat >"$ENV_DATEI" <<ENV
POSTGRES_PASSWORD=${PW_ADMIN}
POSTGRES_MIGRATIONS_PASSWORD=${PW_MIG}
POSTGRES_RUNTIME_PASSWORD=${PW_RT}
JWT_SECRET=$(openssl rand -hex 32)
JWT_ISSUER=pulsedeck
JWT_AUDIENCE=pulsedeck-web
APP_BASE_URL=http://localhost
ENV
compose() { docker compose -p "$PROJEKT" --env-file "$ENV_DATEI" "$@"; }
aufraeumen() { compose down -v >/dev/null 2>&1; rm -rf "$ENV_DATEI" "$ARBEIT"; }
trap aufraeumen EXIT

mkdir -p "$ARBEIT/files" "$ARBEIT/files-restore" && chmod 777 "$ARBEIT/files" "$ARBEIT/files-restore"
# Die Exportdatei-Schreibzugriffe (Checkpoint, Bericht) braucht der Containernutzer; Original bleibt unberührt
cp -a "$EXPORT" "$ARBEIT/export" && chmod -R a+rwX "$ARBEIT/export"
SCHLUESSEL="$(openssl rand -base64 32)"

# CLI im Backend-Image; Verbindungen nur über die Umgebung
cli() { # Datenbank, Dateiverzeichnis, Befehl …
  local db="$1" dateien="$2"; shift 2
  compose run --rm --no-deps -T --entrypoint node \
    -e "MIGRATIONS_DATABASE_URL=postgres://pulsedeck_migrations:${PW_MIG}@postgres:5432/${db}" \
    -e FILES_DIR=/data/files -e "SECRETS_ENCRYPTION_KEY=${SCHLUESSEL}" \
    -v "$ARBEIT/export:/export" -v "${dateien}:/data/files" \
    backend dist/migration/cli.js "$@"
}
schritt() { # Beschreibung, Befehl …
  local was="$1"; shift
  if "$@" >"$ARBEIT/log.txt" 2>&1; then echo "ok     $was"; else echo "FEHLER $was"; sed 's/^/         /' "$ARBEIT/log.txt" | tail -25; FEHLER=1; return 1; fi
}
psql_admin() { compose exec -T postgres psql -U pulsedeck_admin -v ON_ERROR_STOP=1 "$@"; }

echo "== Staging starten =="
compose up -d --build postgres >/dev/null 2>&1 || { echo "FEHLER Start"; exit 1; }
for _ in $(seq 1 30); do compose exec -T postgres pg_isready -U pulsedeck_admin -d pulsedeck >/dev/null 2>&1 && break; sleep 1; done
compose build backend >/dev/null 2>&1 || { echo "FEHLER Build des Backend-Images"; exit 1; }

for db in rehearsal rehearsal_restore; do
  psql_admin -d postgres -c "CREATE DATABASE ${db} OWNER pulsedeck_migrations" >/dev/null || exit 1
done
psql_admin -d rehearsal -c 'CREATE EXTENSION vector' >/dev/null || exit 1
# Migrationen (leeres Ziel) mit der Migrations-Rolle, wie der Backend-Entrypoint
schritt "Migrationen auf leerer Zieldatenbank" compose run --rm --no-deps -T --entrypoint node \
  -e "MIGRATIONS_DATABASE_URL=postgres://pulsedeck_migrations:${PW_MIG}@postgres:5432/rehearsal" \
  backend node_modules/node-pg-migrate/bin/node-pg-migrate.js -d MIGRATIONS_DATABASE_URL up

echo "== Probelauf und Import =="
schritt "Probelauf (alles in einer zurückgerollten Transaktion)" cli rehearsal "$ARBEIT/files" import --from /export --dry-run "$@"
schritt "Import" cli rehearsal "$ARBEIT/files" import --from /export "$@"
cat "$ARBEIT/log.txt" | grep -E "Umwandlung|abgeschlossen" | sed 's/^/         /'
schritt "Validierung des Imports" cli rehearsal "$ARBEIT/files" validate --from /export
grep -c "^ok" "$ARBEIT/log.txt" | sed 's/^/         bestandene Prüfungen: /'

echo "== Backup und Restore =="
schritt "pg_dump (custom format)" bash -c "docker compose -p '$PROJEKT' --env-file '$ENV_DATEI' exec -T postgres pg_dump -U pulsedeck_admin -Fc rehearsal > '$ARBEIT/dump.pgdump'"
schritt "Dateikopie des Volumes" cp -a "$ARBEIT/files/." "$ARBEIT/files-restore/"
# Als Superuser wiederherstellen (legt pgvector an); Eigentümer und Rechte (Migrations- und Runtime-Rolle) stammen aus dem Dump
schritt "pg_restore in frische Datenbank" bash -c "docker compose -p '$PROJEKT' --env-file '$ENV_DATEI' exec -T postgres pg_restore -U pulsedeck_admin -d rehearsal_restore --exit-on-error < '$ARBEIT/dump.pgdump'"
rm -f "$ARBEIT/export/validation-report.json"
schritt "Validierung des Restores gegen dasselbe Manifest" cli rehearsal_restore "$ARBEIT/files-restore" validate --from /export
grep -c "^ok" "$ARBEIT/log.txt" | sed 's/^/         bestandene Prüfungen: /'

[ "$FEHLER" = 0 ] && echo "Probelauf bestanden" || echo "Probelauf FEHLGESCHLAGEN"
exit "$FEHLER"
