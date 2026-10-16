#!/usr/bin/env bash
# Ende-zu-Ende-Smoke des Compose-Stacks in einem isolierten Projekt (eigene Volumes, Wegwerf-Secrets).
# Läuft lokal und in CI:  bash scripts/smoke-compose.sh
# Prüft: Start mit leeren Volumes, Migration-before-serve, Healthchecks, Auth-Ablauf inkl. Rotation und
# Logout, Mandanten-Endpunkte ohne Anmeldung, OpenAPI extern gesperrt (auch per Schreibweise), Fachfunktionen
# durch den Proxy (Organisation, Termine, Beitraege, Dateien, Echtzeit, iCal, Sitemap, Chat/Push ohne Konfiguration),
# unprivilegierter Prozess, Neustart mit Datenerhalt (auch Dateien). Exit 0 nur, wenn alles stimmt.
set -u
cd "$(dirname "$0")/.."

PROJEKT="pulsedeck-smoke-$$"
PORT="${SMOKE_PORT:-18090}"
ENV_DATEI="$(mktemp)"
BASIS="http://localhost:${PORT}"
J='Content-Type: application/json'
FEHLER=0

cat >"$ENV_DATEI" <<ENV
POSTGRES_PASSWORD=$(openssl rand -hex 12)
POSTGRES_MIGRATIONS_PASSWORD=$(openssl rand -hex 12)
POSTGRES_RUNTIME_PASSWORD=$(openssl rand -hex 12)
JWT_SECRET=$(openssl rand -hex 32)
JWT_ISSUER=pulsedeck
JWT_AUDIENCE=pulsedeck-web
APP_BASE_URL=${BASIS}
MAINTENANCE_TOKEN=$(openssl rand -hex 16)
FRONTEND_PORT=${PORT}
ENV
# SMOKE_COMPOSE_FILE=docker-compose.coolify.yml prüft statt der Standarddateien die angegebene Datei. Sie veröffentlicht keine Ports und
# verlangt Produktionsbetrieb; ein Test-Override ergänzt nur Port und Mail-Senke (log), damit der Ablauf von außen prüfbar bleibt.
COMPOSE_ARGS=()
if [ -n "${SMOKE_COMPOSE_FILE:-}" ]; then
  OVERRIDE="$(mktemp)"
  cat >"$OVERRIDE" <<YML
services:
  frontend:
    ports: ["${PORT}:80"]
  backend:
    environment:
      NODE_ENV: development
      MAIL_TRANSPORT: log
YML
  cat >>"$ENV_DATEI" <<ENV
MAIL_TRANSPORT=smtp
SECRETS_ENCRYPTION_KEY=$(openssl rand -base64 32)
ENV
  COMPOSE_ARGS=(-f "$SMOKE_COMPOSE_FILE" -f "$OVERRIDE")
fi
compose() { docker compose -p "$PROJEKT" "${COMPOSE_ARGS[@]}" --env-file "$ENV_DATEI" "$@"; }

aufraeumen() { compose down -v >/dev/null 2>&1; rm -f "$ENV_DATEI" "${OVERRIDE:-}"; }
trap aufraeumen EXIT

pruefe() { # Beschreibung, erwartet, tatsächlich
  if [ "$2" = "$3" ]; then echo "ok     $1"; else echo "FEHLER $1 (erwartet $2, war $3)"; FEHLER=1; fi
}
status() { curl -s -o /dev/null -w '%{http_code}' "$@"; }

echo "== Stack starten (leere Volumes) =="
if ! compose up -d --build >/dev/null 2>&1; then echo "FEHLER docker compose up"; compose logs --tail 40; exit 1; fi
for _ in $(seq 1 60); do
  if compose ps backend --format '{{.Status}}' | grep -q healthy && compose ps frontend --format '{{.Status}}' | grep -q healthy; then break; fi
  sleep 2
done
pruefe "backend healthy" "healthy" "$(compose ps backend --format '{{.Status}}' | grep -o healthy | head -1)"
pruefe "frontend healthy" "healthy" "$(compose ps frontend --format '{{.Status}}' | grep -o healthy | head -1)"
pruefe "postgres ohne Host-Port" "{}" "$(docker inspect "$(compose ps -q postgres)" --format '{{json .HostConfig.PortBindings}}')"

echo "== Auth-Ablauf =="
EMAIL="smoke-$(date +%s)@example.org"; PW="sicher1234"
pruefe "Signup" 202 "$(status -X POST "$BASIS/api/v1/auth/signup" -H "$J" -d "{\"email\":\"$EMAIL\",\"password\":\"$PW\"}")"
sleep 2
TOKEN=$(compose logs backend 2>/dev/null | sed 's/\x1b\[[0-9;]*m//g' | grep "Verifikation an $EMAIL" | grep -o 'token=[A-Za-z0-9_-]*' | tail -1 | cut -d= -f2)
[ -n "$TOKEN" ] || { echo "FEHLER Verifikations-Token nicht im Log"; FEHLER=1; }
pruefe "Login vor Verifikation gesperrt" 403 "$(status -X POST "$BASIS/api/v1/auth/login" -H "$J" -d "{\"email\":\"$EMAIL\",\"password\":\"$PW\"}")"
VERIFY=$(curl -s -X POST "$BASIS/api/v1/auth/verify-email" -H "$J" -d "{\"token\":\"$TOKEN\"}")
feld() { python3 -c "import json,sys; print(json.loads(sys.argv[1]).get('$2',''))" "$1"; }
ZUGRIFF=$(feld "$VERIFY" accessToken); REFRESH=$(feld "$VERIFY" refreshToken)
pruefe "Verify liefert Session" "ja" "$([ -n "$ZUGRIFF" ] && [ -n "$REFRESH" ] && echo ja || echo nein)"
pruefe "Mitgliedschaften (leer)" 200 "$(status "$BASIS/api/v1/me/memberships" -H "Authorization: Bearer $ZUGRIFF")"
pruefe "Mitgliedschaften ohne Token" 401 "$(status "$BASIS/api/v1/me/memberships")"
pruefe "fremde Organisation" 403 "$(status "$BASIS/api/v1/orgs/00000000-0000-4000-8000-000000000000/members/me" -H "Authorization: Bearer $ZUGRIFF")"
ROT=$(curl -s -X POST "$BASIS/api/v1/auth/refresh" -H "$J" -d "{\"refreshToken\":\"$REFRESH\"}")
pruefe "Refresh (Rotation)" "ja" "$([ -n "$(feld "$ROT" refreshToken)" ] && echo ja || echo nein)"
pruefe "altes Refresh-Token abgelehnt" 401 "$(status -X POST "$BASIS/api/v1/auth/refresh" -H "$J" -d "{\"refreshToken\":\"$REFRESH\"}")"
pruefe "Logout" 204 "$(status -X POST "$BASIS/api/v1/auth/logout" -H "$J" -H "Authorization: Bearer $(feld "$ROT" accessToken)" -d "{\"refreshToken\":\"$(feld "$ROT" refreshToken)\"}")"
pruefe "Refresh nach Logout" 401 "$(status -X POST "$BASIS/api/v1/auth/refresh" -H "$J" -d "{\"refreshToken\":\"$(feld "$ROT" refreshToken)\"}")"

echo "== Proxy =="
for pfad in /api/docs /api/docs-json /api/DOCS-json /api/Docs; do
  pruefe "extern gesperrt: $pfad" 404 "$(status "$BASIS$pfad")"
done
pruefe "SPA-Fallback" 200 "$(status "$BASIS/login")"
CSP=$(curl -s -D - -o /dev/null "$BASIS/login" | tr -d '\r' | grep -i '^content-security-policy:')
pruefe "CSP: Skripte nur vom eigenen Ursprung" 1 "$(echo "$CSP" | grep -c "script-src 'self';")"
pruefe "CSP: keine Inline-Handler in index.html" 0 "$(curl -s "$BASIS/" | grep -c -E ' on[a-z]+=\"')"
curl -s -o /dev/null "$BASIS/auth/callback?type=verify&token=smoke-geheimnis"
sleep 1
pruefe "kein Token im nginx-Log" 0 "$(compose logs frontend 2>/dev/null | grep -c smoke-geheimnis)"

echo "== Fachfunktionen (durch den Proxy) =="
LOGIN=$(curl -s -X POST "$BASIS/api/v1/auth/login" -H "$J" -d "{\"email\":\"$EMAIL\",\"password\":\"$PW\"}")
TK=$(feld "$LOGIN" accessToken)
A="Authorization: Bearer $TK"
SLUG="smoke$(date +%s)"
ORG=$(curl -s -X POST "$BASIS/api/v1/orgs" -H "$J" -H "$A" -d "{\"name\":\"Smoke Verein\",\"slug\":\"$SLUG\"}")
OID=$(feld "$ORG" id)
pruefe "Organisation anlegen" "ja" "$([ -n "$OID" ] && echo ja || echo nein)"
pruefe "Doppelter Kurzname" 409 "$(status -X POST "$BASIS/api/v1/orgs" -H "$J" -H "$A" -d "{\"name\":\"Nochmal\",\"slug\":\"$SLUG\"}")"
ME=$(curl -s "$BASIS/api/v1/orgs/$OID/members/me" -H "$A")
pruefe "Besitzer ist Administrator" "True" "$(python3 -c "import json,sys; print(json.loads(sys.argv[1])['access']['isAdmin'])" "$ME")"
pruefe "Öffentliche Organisationsseite" 200 "$(status "$BASIS/api/v1/public/organizations/$SLUG/overview")"
pruefe "Sitemap enthält die Organisation" 1 "$(curl -s "$BASIS/sitemap.xml" | grep -c "/$SLUG<")"
pruefe "robots.txt verweist auf die Sitemap" 1 "$(curl -s "$BASIS/robots.txt" | grep -c "Sitemap: ${BASIS}/sitemap.xml")"

# Echtzeit: Strom öffnen, dann eine Änderung auslösen
SSE=$(mktemp)
curl -s -N --max-time 8 "$BASIS/api/v1/orgs/$OID/realtime?tables=contacts" -H "$A" >"$SSE" 2>/dev/null &
SSE_PID=$!
sleep 2
KONTAKT=$(curl -s -X POST "$BASIS/api/v1/orgs/$OID/contacts" -H "$J" -H "$A" -d '{"name":"Maria","role":"Vorsitz","description":"d","email":"maria@example.org","location":"Berlin"}')
pruefe "Kontakt anlegen" "ja" "$([ -n "$(feld "$KONTAKT" id)" ] && echo ja || echo nein)"
wait "$SSE_PID" 2>/dev/null
pruefe "Echtzeit liefert Bereitschaft" 1 "$(grep -c '^event: ready' "$SSE")"
pruefe "Echtzeit liefert die Änderung (ohne Daten)" 1 "$(grep -c '"table":"contacts"' "$SSE")"
rm -f "$SSE"

EVENT=$(curl -s -X POST "$BASIS/api/v1/orgs/$OID/events" -H "$J" -H "$A" -d '{"title":"Sommerfest","date":"2099-07-01","start_time":"15:00","location":"Park"}')
EID=$(feld "$EVENT" id)
pruefe "Termin anlegen" "ja" "$([ -n "$EID" ] && echo ja || echo nein)"
pruefe "Zusage" 200 "$(status -X PUT "$BASIS/api/v1/orgs/$OID/events/$EID/registration" -H "$J" -H "$A" -d '{"status":"confirmed"}')"
pruefe "Öffentliche Terminseite" 200 "$(status "$BASIS/api/v1/public/events/$EID")"
CAL=$(feld "$ME" calendar_token)
pruefe "iCal-Abo mit Token" 1 "$(curl -s "$BASIS/api/v1/public/ical?token=$CAL" | tr -d '\r' | grep -c '^SUMMARY:Sommerfest')"
pruefe "iCal mit falschem Token" 401 "$(status "$BASIS/api/v1/public/ical?token=falsch")"

pruefe "Beitrag veröffentlichen" "approved" "$(feld "$(curl -s -X POST "$BASIS/api/v1/orgs/$OID/feed" -H "$J" -H "$A" -d '{"title":"Neuigkeit","type":"article","status":"approved"}')" status)"
pruefe "Beitrag in der Liste" 1 "$(curl -s "$BASIS/api/v1/orgs/$OID/feed" -H "$A" | grep -c Neuigkeit)"

DATEI=$(mktemp); echo "Dateiinhalt für den Smoke" >"$DATEI"
UP=$(curl -s -X POST "$BASIS/api/v1/orgs/$OID/files" -H "$A" -F visibility=member -F "file=@${DATEI};type=text/plain;filename=notiz.txt")
FID=$(feld "$UP" id)
pruefe "Datei hochladen" "ja" "$([ -n "$FID" ] && echo ja || echo nein)"
KOPF=$(curl -s -D - -o /dev/null "$BASIS/api/v1/orgs/$OID/files/$FID/content" -H "$A")
pruefe "Download-Inhalt" "Dateiinhalt für den Smoke" "$(curl -s "$BASIS/api/v1/orgs/$OID/files/$FID/content" -H "$A")"
pruefe "Download mit nosniff" 1 "$(echo "$KOPF" | tr -d '\r' | grep -ci '^x-content-type-options: nosniff')"
pruefe "Download ohne Anmeldung" 401 "$(status "$BASIS/api/v1/orgs/$OID/files/$FID/content")"
rm -f "$DATEI"

pruefe "Newsletter-Konfiguration ohne Passwortfeld" 0 "$(curl -s "$BASIS/api/v1/orgs/$OID/newsletter/config" -H "$A" | grep -c 'smtp_pass_encrypted')"
pruefe "Push ohne VAPID-Schlüssel" "False" "$(python3 -c "import json,sys; print(json.loads(sys.argv[1])['enabled'])" "$(curl -s "$BASIS/api/v1/push/config")")"
pruefe "Chat ohne KI-Schlüssel" 503 "$(status -X POST "$BASIS/api/v1/orgs/$OID/chat" -H "$J" -H "$A" -d '{"messages":[{"role":"user","content":"Hallo"}]}')"
pruefe "Datenexport ohne Anmeldung" 401 "$(status "$BASIS/api/v1/me/export")"
pruefe "Datenexport enthält das Konto" "$EMAIL" "$(python3 -c "import json,sys; print(json.loads(sys.argv[1])['account']['email'])" "$(curl -s "$BASIS/api/v1/me/export" -H "$A")")"
pruefe "Datenexport ohne Passwort-Hash" 0 "$(curl -s "$BASIS/api/v1/me/export" -H "$A" | grep -c password_hash)"
pruefe "Chat-Verlauf löschen" 204 "$(status -X DELETE "$BASIS/api/v1/orgs/$OID/chat/history" -H "$A")"
pruefe "Analytics anonym" 204 "$(status -X POST "$BASIS/api/v1/analytics/events" -H "$J" -d '{"event_name":"smoke"}')"
pruefe "Feedback anonym" 204 "$(status -X POST "$BASIS/api/v1/feedback" -H "$J" -d '{"type":"bug","description":"Smoke"}')"
pruefe "Backend läuft nicht als root" "ja" "$([ "$(compose exec -T backend id -u | tr -d '\r')" != "0" ] && echo ja || echo nein)"

echo "== Neustart mit Datenerhalt =="
compose restart backend >/dev/null 2>&1
for _ in $(seq 1 40); do compose ps backend --format '{{.Status}}' | grep -q healthy && break; sleep 2; done
pruefe "Login nach Backend-Neustart" 200 "$(status -X POST "$BASIS/api/v1/auth/login" -H "$J" -d "{\"email\":\"$EMAIL\",\"password\":\"$PW\"}")"
LOGIN2=$(curl -s -X POST "$BASIS/api/v1/auth/login" -H "$J" -d "{\"email\":\"$EMAIL\",\"password\":\"$PW\"}")
pruefe "Datei nach Neustart noch da (Volume)" "Dateiinhalt für den Smoke" "$(curl -s "$BASIS/api/v1/orgs/$OID/files/$FID/content" -H "Authorization: Bearer $(feld "$LOGIN2" accessToken)")"

echo "== Schreibgeschützte Abnahme (READ_ONLY) =="
READ_ONLY=true compose up -d frontend >/dev/null 2>&1
for _ in $(seq 1 20); do compose ps frontend --format '{{.Status}}' | grep -q healthy && break; sleep 2; done
TOKEN_RO=$(feld "$(curl -s -X POST "$BASIS/api/v1/auth/login" -H "$J" -d "{\"email\":\"$EMAIL\",\"password\":\"$PW\"}")" accessToken)
AR="Authorization: Bearer $TOKEN_RO"
pruefe "READ_ONLY: Login bleibt möglich (erreicht das Backend)" "ja" "$([ -n "$TOKEN_RO" ] && echo ja || echo nein)"
pruefe "READ_ONLY: Falsches Passwort → 401 vom Backend, nicht 503" 401 "$(status -X POST "$BASIS/api/v1/auth/login" -H "$J" -d '{"email":"ro-probe@example.org","password":"falsch-falsch"}')"
pruefe "READ_ONLY: Anmeldeseite (E-Mail-Prüfung vor dem Passwort) bleibt möglich" 200 "$(status -X POST "$BASIS/api/v1/auth/check-email" -H "$J" -d "{\"email\":\"$EMAIL\"}")"
pruefe "READ_ONLY: Lesen funktioniert" 200 "$(status "$BASIS/api/v1/orgs/$OID/contacts" -H "$AR")"
pruefe "READ_ONLY: Schreiben wird abgewiesen (503)" 503 "$(status -X POST "$BASIS/api/v1/orgs/$OID/contacts" -H "$J" -H "$AR" -d '{"name":"X","role":"r","description":"d","email":"x@example.org","location":"l"}')"
pruefe "READ_ONLY: Antwort nennt read_only" "read_only" "$(feld "$(curl -s -X DELETE "$BASIS/api/v1/orgs/$OID/files/$FID" -H "$AR")" code)"
pruefe "READ_ONLY: Datei blieb unberührt" "Dateiinhalt für den Smoke" "$(curl -s "$BASIS/api/v1/orgs/$OID/files/$FID/content" -H "$AR")"
READ_ONLY=false compose up -d frontend >/dev/null 2>&1
for _ in $(seq 1 20); do compose ps frontend --format '{{.Status}}' | grep -q healthy && break; sleep 2; done
pruefe "Nach READ_ONLY=false: Schreiben wieder möglich" 201 "$(status -X POST "$BASIS/api/v1/orgs/$OID/contacts" -H "$J" -H "$AR" -d '{"name":"Y","role":"r","description":"d","email":"y@example.org","location":"l"}')"

echo
if [ "$FEHLER" -eq 0 ]; then echo "Smoke bestanden"; else echo "Smoke FEHLGESCHLAGEN"; fi
exit "$FEHLER"
