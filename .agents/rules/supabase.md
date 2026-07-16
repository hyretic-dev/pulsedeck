---
description: Supabase-Konventionen — Edge Functions (Deno), SQL-Migrationen, RLS, Typsicherheit
globs: supabase/**/*.ts,supabase/**/*.sql
alwaysApply: false
---

# Backend: Supabase

## Edge Functions

- Jede Function lebt unter `supabase/functions/<function-name>/index.ts`.
- Runtime: **Deno** (TypeScript). Imports über `jsr:` oder `npm:`.

### Struktur jeder Edge Function

1. **CORS-Headers** als Standardmuster (identisch in allen Functions):
   ```typescript
   const corsHeaders = {
     'Access-Control-Allow-Origin': '*',
     'Access-Control-Allow-Headers':
       'authorization, x-client-info, apikey, content-type',
   };
   ```
2. **OPTIONS-Preflight** als erstes abfangen.
3. **Auth-Validierung:** `Authorization`-Header prüfen, Token über `supabaseAdmin.auth.getUser(token)` verifizieren.
4. **Admin-Prüfung** (wenn nötig): `app_role` aus `members`-Tabelle prüfen. Nie dem Client vertrauen.
5. **Eingabe validieren:** Request-Body über typisiertes Interface prüfen. Pflichtfelder explizit prüfen, fehlende als 400 zurückgeben.
6. **Supabase Admin Client:** Immer mit `SUPABASE_SERVICE_ROLE_KEY` — nie `SUPABASE_ANON_KEY` für privilegierte Operationen.

### Fehlerbehandlung

- Responses immer als JSON mit `Content-Type: application/json`.
- Fehler-Shape konsistent: `{ error: string }`.
- Erfolg-Shape: `{ message: string, …data }`.
- HTTP-Status korrekt: 400 (Eingabe), 401 (nicht authentifiziert), 403 (nicht autorisiert), 404 (nicht gefunden), 500 (Server-Fehler).
- Top-Level `try/catch` in jeder Function, das unerwartete Fehler als 500 + JSON zurückgibt.

### Typsicherheit

- Kein `any`. Request-Bodies über Interface tippen.
- `Deno.env.get()` für Environment-Variablen — nie hardcoded.

## SQL & Migrationen

- Schema-Änderungen über `supabase/migrations/` — nie direkt in der Datenbank.
- **RLS auf jeder Tabelle.** Keine Tabelle ohne Row Level Security.
- Policies explizit benennen (z.B. `"Members Visibility"`, `"Members Manage"`).
- Helper-Functions (`get_my_role()`, `get_my_member_id()`) als `SECURITY DEFINER` — existieren bereits, wiederverwenden.
- Neue Tabellen dokumentieren: Zweck, Spalten, RLS-Intention als SQL-Kommentar.
- Migrationen prüfen, nie blind generierte Migrationen übernehmen.

## Bestandsschutz

Das bestehende Schema (`contacts`, `members`, `events`, `working_groups`, `working_group_members`, `wiki_docs`, `feedback_submissions`) bleibt unverändert — kein Rename bestehender Tabellen oder Spalten ohne expliziten Auftrag.
