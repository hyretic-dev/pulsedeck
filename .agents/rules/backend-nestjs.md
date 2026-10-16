---
description: Backend-Konventionen — NestJS-Module, PostgreSQL (pg + node-pg-migrate), Autorisierung in Guards, Tests gegen echte DB
globs: backend/**/*.ts,backend/**/*.sql
alwaysApply: false
---

# Backend: NestJS + PostgreSQL

Gültige Architektur- und Rechteentscheidungen (IDs `E…`/`O…`/`D…` in Kommentaren): `docs/architektur-entscheidungen.md`.

## Aufbau

- Ein Modul je Fachbereich unter `backend/src/<feature>/` (Controller, Service, DTOs, Specs). Auth, Tenancy, Mail, Jobs,
  Storage sind gemeinsame Infrastruktur.
- Pinning: NestJS und Abhängigkeiten exakt in `backend/package.json`; neue Pakete nur mit Begründung.
- SQL handgeschrieben und parametrisiert über `pg` — nie Werte in SQL-Text einsetzen. Bezeichner nur aus Konstanten.
- Konfiguration ausschließlich über `config/configuration.ts` (validiert beim Start, Pflichtwerte brechen den Start ab).
  Neue Variablen: dort, in `.env.example` und im Compose-File ergänzen. Geheimnisse nie loggen, nie in Build-Args.

## Autorisierung und Mandantentrennung

- Es gibt **keine Row Level Security**. Rechte leben in Guards und Services: `JwtAuthGuard` → `OrgGuard` (Mitgliedschaft aus
  der DB, nie aus dem Client) → `PermissionGuard` (`@RequireAdmin`, `@RequirePermission`). Plattformrechte: `PlatformAdminGuard`.
- Jede Abfrage ist an die Organisation des Aufrufers gebunden (`WHERE organization_id = $n`), auch bei Einzelobjekten,
  Zählungen, Suche, Dateien, Streams. Sichtbarkeit (`member`/`committee`/`admin`, AG-Bezug) wird in SQL gefiltert, nicht danach.
- Unsichtbar → 404, sichtbar aber nicht erlaubt → 403. Die Rechte stehen in `docs/architektur-entscheidungen.md` („Rechte“);
  jede Änderung der Rechte ändert dort die Zeile und bekommt einen Negativtest.
- Nebenwirkungen (Audit `schreibeAudit`, Echtzeit `meldeAenderung`, Mail/Push über Outbox bzw. Queue) laufen in derselben
  Transaktion wie die Änderung. Keine Trigger.

## Migrationen

- Schema-Änderungen nur über `backend/migrations/` (node-pg-migrate, SQL, Up und Down). Nie direkt in der Datenbank.
  Migrationen laufen mit der Migrations-Rolle; die Runtime-Rolle hat nur DML. Neue Tabellen: Grants für `pulsedeck_runtime`
  in derselben Migration und Zweck als Kommentar.

## Fehler und API-Vertrag

- Antworten: HTTP-Status korrekt (400/401/403/404/409/429/500) und Body `{ code, message }`; keine Stacktraces, keine
  Secrets, keine Enumeration über Meldungen. DTOs mit `class-validator`; Pflichtfelder und Grenzen explizit.
- OpenAPI (`/api/docs`) muss zur Implementierung passen (`openapi.spec.ts`).

## Tests

- Fachliche Tests als Integrationstests gegen echtes PostgreSQL (`test/pg-test-db.ts`, Container auf Port 5433, eine DB je Spec).
  Mocks sind kein Nachweis für Constraints, Atomarität oder Rechte.
- Jede Rechteprüfung braucht Negativtests (fremde Organisation, zu niedrige Rolle, unsichtbares Objekt) und wird per Mutation
  gegengeprüft (Guard ausbauen → Test muss rot werden).
- Gate vor jedem Commit: `cd backend && npx tsc --noEmit && npm test && npm run build`.
