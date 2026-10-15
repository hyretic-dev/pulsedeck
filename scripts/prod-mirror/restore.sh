#!/usr/bin/env bash
# Stellt einen Abzug von capture.sh in eine lokale Datenbank wieder her (Standard: prod_local im Test-Container auf Port 5433).
# Lokal ist nichts mit Produktion verbunden: pg_cron-Jobs und pg_net werden NICHT nachgebaut (sie würden Produktionsadressen aufrufen).
#
#   bash scripts/prod-mirror/restore.sh [abzug-verzeichnis] [datenbankname]
#   LOCAL_PG_CONTAINER (Standard pulsedeck-pg-test), LOCAL_PG_ADMIN (Standard postgres)
set -euo pipefail
cd "$(dirname "$0")/../.."
umask 077

DIR="${1:-$(cat backups/.latest 2>/dev/null || true)}"
DB="${2:-prod_local}"
C="${LOCAL_PG_CONTAINER:-pulsedeck-pg-test}"
ADMIN="${LOCAL_PG_ADMIN:-postgres}"
[ -d "$DIR" ] && [ -f "$DIR/prod-public.pgdump" ] || { echo "Abzug-Verzeichnis fehlt oder unvollständig (erwartet $DIR/prod-public.pgdump)"; exit 2; }
git check-ignore -q "$DIR/" || { echo "$DIR ist nicht git-ignoriert – Abbruch"; exit 2; }
LOG="$DIR/restore.log"; : >"$LOG"
say() { echo "$*" | tee -a "$LOG"; }
psql_c() { docker exec -i "$C" psql -U "$ADMIN" -X -v ON_ERROR_STOP=1 "$@"; }

say "== Datenbank $DB neu anlegen =="
psql_c -d postgres -c "DROP DATABASE IF EXISTS $DB WITH (FORCE)" -c "CREATE DATABASE $DB" >>"$LOG" 2>&1
# Plattform-Gerüst (Rollen, Schemas, auth.uid() …) wie im Replay; die Stub-Tabellen ersetzt der echte Abzug
psql_c -d "$DB" <backend/scripts/legacy-replay/stubs.sql >>"$LOG" 2>&1
psql_c -d "$DB" -c "CREATE EXTENSION IF NOT EXISTS vector WITH SCHEMA public" \
  -c "DROP TABLE IF EXISTS auth.identities, auth.users, storage.objects, storage.buckets CASCADE" \
  -c "DROP PUBLICATION IF EXISTS supabase_realtime" -c "CREATE SCHEMA IF NOT EXISTS supabase_migrations" >>"$LOG" 2>&1

restore() { # Datei, Beschreibung
  [ -f "$1" ] || { say "  $2: Datei fehlt, übersprungen"; return; }
  # Fehler einzelner Objekte brechen nichts ab, werden aber gezählt und stehen im Log (zu prüfen)
  local fehler
  docker exec -i "$C" pg_restore -U "$ADMIN" -d "$DB" --no-owner --no-privileges <"$1" >>"$LOG" 2>&1 || true
  fehler="$(grep '^pg_restore: error' "$LOG" | grep -vcE 'schema "public" already exists|storage\.(protect_delete|update_updated_at_column|enforce_|protect_bucket)|handle_new_user_linking' || true)"
  say "  $2: wiederhergestellt (bisher $fehler Fehlermeldungen im Log)"
}
# Enum-Typen der Plattformschemas (z. B. storage.buckettype) stehen nicht im Tabellen-Dump, die Tabellen brauchen sie
for f in "$DIR"/schema-auth.sql "$DIR"/schema-storage.sql; do
  [ -f "$f" ] && python3 - "$f" <<'PY' | psql_c -d "$DB" >>"$LOG" 2>&1 || true
import re, sys
text = open(sys.argv[1], encoding='utf-8').read()
for m in re.finditer(r'^CREATE TYPE [^;]*?;', text, re.M | re.S): print(m.group(0))
PY
done
say "== Daten =="
restore "$DIR/prod-platform.pgdump" "auth, storage, Migrationsstand"
restore "$DIR/prod-public.pgdump" "public"

# Realtime-Publication laut Inventar nachbauen (die Dumps schließen Publications nicht zuverlässig ein)
if [ -f "$DIR/inventory/publications.tsv" ]; then
  say "== Realtime-Publication =="
  python3 - "$DIR/inventory/publications.tsv" <<'PY' | psql_c -d "$DB" >>"$LOG" 2>&1 || say "  Publication konnte nicht vollständig angelegt werden (Log)"
import sys, collections
pubs = collections.OrderedDict()
for z in open(sys.argv[1], encoding='utf-8').read().splitlines():
    p = z.split('\t')
    if len(p) < 6: continue
    name, alle, ins, upd, dele, tab = p[:6]
    e = pubs.setdefault(name, {'alle': alle == 't', 'ops': [o for o, f in (('insert', ins), ('update', upd), ('delete', dele)) if f == 't'], 'tabs': []})
    if tab and tab.startswith('public.'): e['tabs'].append(tab)
for name, e in pubs.items():
    if not e['alle'] and not e['tabs']: continue  # Plattform-Publication ohne Tabellen in public
    q = '"' + name.replace('"', '""') + '"'
    ops = ', '.join(e['ops']) or 'insert'
    if e['alle']: print(f'CREATE PUBLICATION {q} FOR ALL TABLES WITH (publish = \'{ops}\');')
    elif e['tabs']: print(f'CREATE PUBLICATION {q} FOR TABLE ' + ', '.join('.'.join(f'"{x}"' for x in t.split('.', 1)) for t in e['tabs']) + f' WITH (publish = \'{ops}\');')
    else: print(f'CREATE PUBLICATION {q} WITH (publish = \'{ops}\');')
PY
  say "  $(psql_c -d "$DB" -Atc "select count(*) from pg_publication_tables") Tabellen in Publications"
fi

say "== Stichprobe =="
psql_c -d "$DB" -At -c "select 'public-Tabellen: ' || count(*) from information_schema.tables where table_schema='public' and table_type='BASE TABLE'" \
  -c "select 'auth.users: ' || count(*) from auth.users" -c "select 'storage.objects: ' || count(*) from storage.objects" 2>&1 | tee -a "$LOG" || true
say ""
say "Lokale Kopie: postgres://$ADMIN:<Passwort des Containers>@127.0.0.1:5433/$DB"
say "Weiter: LEGACY_DATABASE_URL=… node backend/dist/migration/cli.js export …  und  node scripts/prod-mirror/parity.mjs $DIR"
