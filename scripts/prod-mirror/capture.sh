#!/usr/bin/env bash
# Zieht den aktuellen Produktionsstand (Supabase) lokal: Inventar, Schema, Daten, optional Konfiguration und Storage.
# Nur lesend gegenüber Produktion. Die Ergebnisse enthalten Personendaten und Passwort-Hashes und liegen in backups/
# (git-ignoriert, Rechte 700/600).
#
#   bash scripts/prod-mirror/capture.sh [env-datei]        (Standard: backups/.prod.env)
#
# Die Env-Datei legt der Betreiber selbst an (siehe README.md); sie enthält Zugangsdaten und wird nie ausgegeben:
#   PROD_DATABASE_URL        Pflicht: Lesezugang, z. B. postgres://postgres:<pw>@db.<ref>.supabase.co:5432/postgres?sslmode=require
#   SUPABASE_PROJECT_REF     optional (Konfiguration über die Management-API)
#   SUPABASE_ACCESS_TOKEN    optional: persönliches Zugriffstoken (Auth-Konfiguration, Funktionen, Secret-Namen)
#   SUPABASE_S3_ENDPOINT, SUPABASE_S3_ACCESS_KEY_ID, SUPABASE_S3_SECRET_ACCESS_KEY, SUPABASE_S3_REGION
#                            optional: Storage-Spiegel des Buckets `files` (S3-kompatibler Endpunkt des Projekts)
#   PG_CLIENT_IMAGE          optional: Image mit psql/pg_dump (Standard pgvector/pgvector:pg17; bei Server ≥ 18 passendes Image)
set -euo pipefail
cd "$(dirname "$0")/../.."
umask 077

ENV_DATEI="${1:-backups/.prod.env}"
[ -f "$ENV_DATEI" ] || { echo "Env-Datei $ENV_DATEI fehlt (Vorlage: scripts/prod-mirror/prod.env.example)"; exit 2; }
git check-ignore -q backups/ || { echo "backups/ ist nicht git-ignoriert – Abbruch (Personendaten)"; exit 2; }
# shellcheck disable=SC1090
set -a; . "$ENV_DATEI"; set +a
[ -n "${PROD_DATABASE_URL:-}" ] || { echo "PROD_DATABASE_URL fehlt in $ENV_DATEI"; exit 2; }
IMAGE="${PG_CLIENT_IMAGE:-pgvector/pgvector:pg17}"

# Verbindungsdaten als libpq-Variablen (das Passwort steht nie in einer Kommandozeile)
eval "$(python3 - <<'PY'
import os, shlex
from urllib.parse import urlparse, parse_qs, unquote
u = urlparse(os.environ['PROD_DATABASE_URL'])
q = parse_qs(u.query)
vals = {'PGHOST': u.hostname or '', 'PGPORT': str(u.port or 5432), 'PGUSER': unquote(u.username or ''), 'PGPASSWORD': unquote(u.password or ''),
        'PGDATABASE': (u.path or '/postgres').lstrip('/') or 'postgres', 'PGSSLMODE': q.get('sslmode', ['require'])[0]}
for k, v in vals.items(): print(f'export {k}={shlex.quote(v)}')
PY
)"
unset PROD_DATABASE_URL

OUT="backups/prod-$(date -u +%Y%m%d-%H%M%S)"
mkdir -p -m 700 "$OUT/inventory" "$OUT/config"
LOG="$OUT/capture.log"
: >"$LOG"
say() { echo "$*" | tee -a "$LOG"; }

pg() { # Befehl und Argumente laufen im Client-Image, Ausgabe-Verzeichnis eingehängt
  docker run --rm -i --user "$(id -u):$(id -g)" --network host -e PGHOST -e PGPORT -e PGUSER -e PGPASSWORD -e PGDATABASE -e PGSSLMODE \
    -v "$PWD/$OUT:/out" -v "$PWD/scripts/prod-mirror:/scripts:ro" "$IMAGE" "$@"
}

say "== Verbindung und Version =="
VERSION_NUM="$(pg psql -X -Atc "show server_version_num" 2>>"$LOG")" || { say "FEHLER Verbindung zu $PGHOST:$PGPORT nicht möglich (Details in $LOG)"; exit 10; }
MAJOR=$((VERSION_NUM / 10000))
say "PostgreSQL $MAJOR auf $PGHOST (Rolle $PGUSER)"
CLIENT_MAJOR="$(pg pg_dump --version | sed -E 's/.* ([0-9]+)\..*/\1/')"
if [ "$MAJOR" -gt "$CLIENT_MAJOR" ]; then say "FEHLER Server $MAJOR ist neuer als pg_dump $CLIENT_MAJOR – PG_CLIENT_IMAGE=postgres:$MAJOR setzen"; exit 11; fi

say "== Inventar (nur Strukturen und Zähler) =="
pg psql -X -v ON_ERROR_STOP=0 -v outdir=/out/inventory -f /scripts/inventory.sql >>"$LOG" 2>&1 || true
for f in "$OUT"/inventory/*.tsv; do say "  $(basename "$f"): $(wc -l <"$f") Zeilen"; done

say "== Schema (alle relevanten Schemas, ohne Daten) =="
for s in public auth storage realtime supabase_functions supabase_migrations; do
  if pg pg_dump --schema-only --no-owner --no-privileges -n "$s" >"$OUT/schema-$s.sql" 2>>"$LOG"; then say "  $s: $(wc -l <"$OUT/schema-$s.sql") Zeilen"; else say "  $s: nicht abrufbar (siehe Log)"; rm -f "$OUT/schema-$s.sql"; fi
done

say "== Daten =="
pg pg_dump -Fc --no-owner --no-privileges -n public >"$OUT/prod-public.pgdump" 2>>"$LOG" || { say "FEHLER Dump von public"; exit 12; }
say "  public: $(du -h "$OUT/prod-public.pgdump" | cut -f1)"
pg pg_dump -Fc --no-owner --no-privileges -t auth.users -t auth.identities -t storage.buckets -t storage.objects -t supabase_migrations.schema_migrations \
  >"$OUT/prod-platform.pgdump" 2>>"$LOG" || say "  Plattformtabellen: Teile nicht abrufbar (siehe Log) – Dump enthält, was lesbar war"
say "  auth/storage: $(du -h "$OUT/prod-platform.pgdump" | cut -f1)"

# Management-API: Konfiguration, die nicht in der Datenbank steht. Best effort; ein Fehler bricht nichts ab.
if [ -n "${SUPABASE_ACCESS_TOKEN:-}" ] && [ -n "${SUPABASE_PROJECT_REF:-}" ]; then
  say "== Konfiguration über die Management-API =="
  api() { # Pfad, Zieldatei – das Token geht über stdin, nicht über die Kommandozeile
    local code
    code="$(printf 'header = "Authorization: Bearer %s"\n' "$SUPABASE_ACCESS_TOKEN" | curl -sS -K - -o "$2" -w '%{http_code}' "https://api.supabase.com/v1/projects/$SUPABASE_PROJECT_REF/$1" 2>>"$LOG")" || code=000
    if [ "$code" = 200 ]; then say "  $1: ok"; else say "  $1: HTTP $code (nicht abrufbar)"; rm -f "$2"; fi
  }
  api config/auth "$OUT/config/auth-config.json"
  api functions "$OUT/config/functions.json"
  api secrets "$OUT/config/secrets.json"
  api postgrest "$OUT/config/postgrest.json"
  if [ -f "$OUT/config/functions.json" ]; then
    for slug in $(python3 -c "import json,sys; print(' '.join(f['slug'] for f in json.load(open(sys.argv[1]))))" "$OUT/config/functions.json"); do
      api "functions/$slug/body" "$OUT/config/function-$slug.body"
    done
  fi
else
  say "== Management-API übersprungen (SUPABASE_ACCESS_TOKEN/SUPABASE_PROJECT_REF nicht gesetzt) =="
fi

if [ -n "${SUPABASE_S3_ENDPOINT:-}" ] && [ -n "${SUPABASE_S3_ACCESS_KEY_ID:-}" ] && [ -n "${SUPABASE_S3_SECRET_ACCESS_KEY:-}" ]; then
  say "== Storage-Spiegel (Bucket files) =="
  mkdir -p -m 700 "$OUT/storage/files"
  export RCLONE_CONFIG_SB_TYPE=s3 RCLONE_CONFIG_SB_PROVIDER=Other RCLONE_CONFIG_SB_ENDPOINT="$SUPABASE_S3_ENDPOINT" \
         RCLONE_CONFIG_SB_ACCESS_KEY_ID="$SUPABASE_S3_ACCESS_KEY_ID" RCLONE_CONFIG_SB_SECRET_ACCESS_KEY="$SUPABASE_S3_SECRET_ACCESS_KEY" \
         RCLONE_CONFIG_SB_REGION="${SUPABASE_S3_REGION:-eu-central-1}"
  if docker run --rm -e RCLONE_CONFIG_SB_TYPE -e RCLONE_CONFIG_SB_PROVIDER -e RCLONE_CONFIG_SB_ENDPOINT -e RCLONE_CONFIG_SB_ACCESS_KEY_ID \
       -e RCLONE_CONFIG_SB_SECRET_ACCESS_KEY -e RCLONE_CONFIG_SB_REGION -v "$PWD/$OUT/storage/files:/data" rclone/rclone:latest \
       sync sb:files /data --checksum --stats-one-line >>"$LOG" 2>&1; then
    say "  $(find "$OUT/storage/files" -type f | wc -l) Dateien, $(du -sh "$OUT/storage/files" | cut -f1)"
  else say "  FEHLER beim Spiegeln (siehe Log)"; fi
else
  say "== Storage-Spiegel übersprungen (SUPABASE_S3_* nicht gesetzt) =="
fi

chmod -R go-rwx "$OUT"
echo "$OUT" >backups/.latest
say ""
say "Fertig: $OUT"
say "Weiter: bash scripts/prod-mirror/restore.sh   (lokale Wiederherstellung), danach node scripts/prod-mirror/parity.mjs"
