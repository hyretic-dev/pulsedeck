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
verlangt "Coolify verlangt SECRETS_ENCRYPTION_KEY" SECRETS_ENCRYPTION_KEY -f docker-compose.coolify.yml
verlangt "Coolify verlangt MAIL_TRANSPORT" MAIL_TRANSPORT -f docker-compose.coolify.yml
verlangt "Coolify verlangt APP_BASE_URL" APP_BASE_URL -f docker-compose.coolify.yml
verlangt "Coolify verlangt JWT_SECRET" JWT_SECRET -f docker-compose.coolify.yml
# Der Coolify-Stack veröffentlicht keine Host-Ports und hängt an keinem selbst definierten Netz
PORTS="$(docker compose --env-file "$ENV_DATEI" -f docker-compose.coolify.yml config --format json 2>/dev/null | python3 -c "import json,sys; d=json.load(sys.stdin); print(sum(1 for s in d['services'].values() if s.get('ports')) + len([n for n in d.get('networks', {}) if n != 'default']))")"
if [ "$PORTS" = "0" ]; then echo "ok     Coolify: keine veröffentlichten Ports, keine eigenen Netze"; else echo "FEHLER Coolify veröffentlicht Ports oder definiert Netze"; FEHLER=1; fi
exit "$FEHLER"
