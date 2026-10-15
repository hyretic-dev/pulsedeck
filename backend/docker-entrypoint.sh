#!/bin/sh
set -e

# Migration-before-serve: Migrationen mit der Migrations-Rolle ausführen;
# schlägt das fehl, startet der Server nicht.
echo "Führe DB-Migrationen aus (Migrations-Rolle)…"
node node_modules/node-pg-migrate/bin/node-pg-migrate.js -d MIGRATIONS_DATABASE_URL up

exec node dist/main.js
