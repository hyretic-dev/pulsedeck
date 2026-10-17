#!/bin/sh
set -e

# Pflichtprüfung der Datenbank-Passwörter vor jeder Aktion: Compose baut die URLs aus POSTGRES_*_PASSWORD, ein fehlender Wert ergibt
# `user:@host`. (Die übrigen Pflichtwerte - JWT_SECRET, APP_BASE_URL, MAIL_TRANSPORT, SECRETS_ENCRYPTION_KEY - prüft die Backend-Konfiguration.)
case "$DATABASE_URL" in *://*:@*) echo "FEHLER: POSTGRES_RUNTIME_PASSWORD fehlt (leeres Passwort in DATABASE_URL)" >&2; exit 1 ;; esac
case "$MIGRATIONS_DATABASE_URL" in *://*:@*) echo "FEHLER: POSTGRES_MIGRATIONS_PASSWORD fehlt (leeres Passwort in MIGRATIONS_DATABASE_URL)" >&2; exit 1 ;; esac

# Migration-before-serve: Migrationen mit der Migrations-Rolle ausführen;
# schlägt das fehl, startet der Server nicht.
echo "Führe DB-Migrationen aus (Migrations-Rolle)…"
node node_modules/node-pg-migrate/bin/node-pg-migrate.js -d MIGRATIONS_DATABASE_URL up

exec node dist/main.js
