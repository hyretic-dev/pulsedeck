#!/bin/sh
# Schreibgeschützte Abnahme nach der Migration (READ_ONLY=true): schreibende API-Aufrufe liefert nginx als 503, bevor sie das
# Backend erreichen. Anmelden, Token erneuern und Abmelden bleiben möglich, damit die Abnahme mit echten Konten laufen kann.
# Läuft als Skript des nginx-Entrypoints bei jedem Containerstart und schreibt die Include-Datei neu.
set -e
DATEI=/etc/nginx/readonly.conf
if [ "${READ_ONLY:-false}" = "true" ]; then
  cat >"$DATEI" <<'CONF'
default_type application/json;
set $schreibsperre 0;
if ($request_method ~ ^(POST|PUT|PATCH|DELETE)$) { set $schreibsperre 1; }
if ($uri ~ ^/api/v1/auth/(login|refresh|logout|check-email)$) { set $schreibsperre 0; }
if ($schreibsperre = 1) { return 503 '{"code":"read_only","message":"Die Plattform ist vorübergehend schreibgeschützt (Abnahme nach der Migration)."}'; }
CONF
  echo "READ_ONLY aktiv: schreibende API-Aufrufe werden mit 503 abgewiesen"
else
  : >"$DATEI"
fi
