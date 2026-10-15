#!/bin/bash
# Legt die getrennten DB-Rollen an (Auftrag §4):
# - pulsedeck_migrations: DDL/Owner für Migrationen
# - pulsedeck_runtime: nur DML auf App-Tabellen (Grants kommen aus Migration 000004)
set -e

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<-EOSQL
  CREATE ROLE pulsedeck_migrations LOGIN PASSWORD '${POSTGRES_MIGRATIONS_PASSWORD}';
  CREATE ROLE pulsedeck_runtime LOGIN PASSWORD '${POSTGRES_RUNTIME_PASSWORD}';
  GRANT CREATE ON SCHEMA public TO pulsedeck_migrations;
  GRANT CREATE ON DATABASE ${POSTGRES_DB} TO pulsedeck_migrations;
  -- pgvector ist nicht „trusted": Die Migrations-Rolle darf sie nicht anlegen (Wissensbasis des Chatbots).
  CREATE EXTENSION IF NOT EXISTS vector;
EOSQL
