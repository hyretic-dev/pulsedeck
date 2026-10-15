#!/usr/bin/env bash
# Prüft, dass alle Compose-Varianten gültig sind (YAML, Interpolation, Pflichtvariablen) und dass fehlende Pflichtwerte den Start
# verhindern. Schnell, ohne Docker-Build:  bash scripts/check-compose.sh
set -u
cd "$(dirname "$0")/.."
FEHLER=0
ENV_DATEI="$(mktemp)"; trap 'rm -f "$ENV_DATEI"' EXIT
cat >"$ENV_DATEI" <<ENV
POSTGRES_PASSWORD=p1
POSTGRES_MIGRATIONS_PASSWORD=p2
POSTGRES_RUNTIME_PASSWORD=p3
JWT_SECRET=$(printf 'a%.0s' $(seq 1 64))
JWT_ISSUER=pulsedeck
JWT_AUDIENCE=pulsedeck-web
APP_BASE_URL=https://app.example.org
MAIL_TRANSPORT=smtp
SECRETS_ENCRYPTION_KEY=$(printf 'b%.0s' $(seq 1 43))=
ENV
gueltig() { # Beschreibung, Compose-Argumente
  local was="$1"; shift
  if out="$(docker compose --env-file "$ENV_DATEI" "$@" config -q 2>&1)"; then echo "ok     $was"; else echo "FEHLER $was"; echo "$out" | head -3 | sed 's/^/         /'; FEHLER=1; fi
}
verlangt() { # Beschreibung, fehlende Variable, Compose-Argumente
  local was="$1" var="$2"; shift 2
  if grep -v "^$var=" "$ENV_DATEI" >"$ENV_DATEI.ohne" && docker compose --env-file "$ENV_DATEI.ohne" "$@" config -q >/dev/null 2>&1; then echo "FEHLER $was (Start trotz fehlendem $var möglich)"; FEHLER=1; else echo "ok     $was"; fi
  rm -f "$ENV_DATEI.ohne"
}

gueltig "Basis (docker-compose.yml)" -f docker-compose.yml
gueltig "Basis + Produktion (docker-compose.prod.yml)" -f docker-compose.yml -f docker-compose.prod.yml
gueltig "Coolify (docker-compose.coolify.yml)" -f docker-compose.coolify.yml
verlangt "Produktion verlangt SECRETS_ENCRYPTION_KEY" SECRETS_ENCRYPTION_KEY -f docker-compose.yml -f docker-compose.prod.yml
verlangt "Produktion verlangt MAIL_TRANSPORT" MAIL_TRANSPORT -f docker-compose.yml -f docker-compose.prod.yml
# Coolify baut mit einer Env-Datei ohne Laufzeitvariablen (Variablen sind „Runtime only“, damit Geheimnisse nicht als Build-Argumente im
# Image landen): `docker compose build` muss ohne jeden Wert gelingen. Die Pflichtwerte prüfen die Dienste beim Start (unten).
if docker compose --env-file /dev/null -f docker-compose.coolify.yml config -q >/dev/null 2>&1; then echo "ok     Coolify: baubar ohne Laufzeitvariablen"; else echo "FEHLER Coolify: Compose braucht beim Bauen Variablen (Pflichtprüfung ':?' gehört in die Dienste)"; FEHLER=1; fi
# Dienste verweigern den Start bei fehlenden Datenbank-Passwörtern, bevor etwas passiert
if out="$(DATABASE_URL='postgres://u:@h:5432/d' MIGRATIONS_DATABASE_URL='postgres://m:pw@h:5432/d' sh backend/docker-entrypoint.sh 2>&1)"; then echo "FEHLER Backend startet mit leerem Runtime-Passwort"; FEHLER=1; elif echo "$out" | grep -q "POSTGRES_RUNTIME_PASSWORD"; then echo "ok     Backend verweigert den Start ohne POSTGRES_RUNTIME_PASSWORD (mit Meldung)"; else echo "FEHLER Backend bricht ohne klare Meldung ab: $out"; FEHLER=1; fi
if out="$(DATABASE_URL='postgres://u:pw@h:5432/d' MIGRATIONS_DATABASE_URL='postgres://m:@h:5432/d' sh backend/docker-entrypoint.sh 2>&1)"; then echo "FEHLER Backend startet mit leerem Migrations-Passwort"; FEHLER=1; elif echo "$out" | grep -q "POSTGRES_MIGRATIONS_PASSWORD"; then echo "ok     Backend verweigert den Start ohne POSTGRES_MIGRATIONS_PASSWORD (mit Meldung)"; else echo "FEHLER Backend bricht ohne klare Meldung ab: $out"; FEHLER=1; fi
if out="$(POSTGRES_USER=x POSTGRES_DB=y POSTGRES_MIGRATIONS_PASSWORD= POSTGRES_RUNTIME_PASSWORD=pw bash docker/postgres/10-roles.sh 2>&1)"; then echo "FEHLER Rollenskript läuft mit leerem Passwort"; FEHLER=1; elif echo "$out" | grep -q "POSTGRES_MIGRATIONS_PASSWORD"; then echo "ok     Rollenskript verweigert leere Rollenpasswörter (mit Meldung)"; else echo "FEHLER Rollenskript bricht ohne klare Meldung ab: $out"; FEHLER=1; fi
# Der Coolify-Stack veröffentlicht keine Host-Ports und hängt an keinem selbst definierten Netz
PORTS="$(docker compose --env-file "$ENV_DATEI" -f docker-compose.coolify.yml config --format json 2>/dev/null | python3 -c "import json,sys; d=json.load(sys.stdin); print(sum(1 for s in d['services'].values() if s.get('ports')) + len([n for n in d.get('networks', {}) if n != 'default']))")"
if [ "$PORTS" = "0" ]; then echo "ok     Coolify: keine veröffentlichten Ports, keine eigenen Netze"; else echo "FEHLER Coolify veröffentlicht Ports oder definiert Netze"; FEHLER=1; fi
exit "$FEHLER"
