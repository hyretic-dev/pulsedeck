# Produktionsstand lokal abbilden (Dump, Inventar, Parität)

Ziel: den **aktuellen** Stand der Supabase-Produktion lokal haben – Daten **und** alles, was nur dort existiert (Realtime-Publication,
pg_cron, Trigger, im Dashboard angelegte Tabellen, Buckets, Auth-Bestand) – und gegen unseren Nachbau halten. Alles ist **lesend**
gegenüber Produktion. Die Abzüge enthalten Personendaten und Passwort-Hashes und liegen in `backups/` (git-ignoriert, Rechte 700/600).

## Was dafür nötig ist (vom Betreiber, nicht im Chat)

1. **Datenbank-Zugang** (Pflicht): Connection string im Supabase-Dashboard (Project Settings → Database). Session-Pooler oder direkte
   Verbindung, **nicht** der Transaction-Pooler. Idealerweise ein eigenes Lesekonto.
2. *Optional* **persönliches Zugriffstoken** (Dashboard → Account → Access Tokens): Auth-Konfiguration, Edge-Function-Liste/-Quellen, Secret-Namen.
3. *Optional* **S3-Zugang des Storage** (Project Settings → Storage → S3 Connection): Spiegel des Buckets `files`.

```bash
mkdir -p backups && cp scripts/prod-mirror/prod.env.example backups/.prod.env && chmod 600 backups/.prod.env
$EDITOR backups/.prod.env        # Werte selbst eintragen
```

## Ablauf

```bash
cd backend && npm run build && cd ..                 # Paritätsabgleich und Migrationswerkzeug brauchen dist/
bash scripts/prod-mirror/capture.sh                  # Inventar, Schema, Daten (+ optional Konfiguration, Storage) nach backups/prod-<zeit>/
bash scripts/prod-mirror/restore.sh                  # lokal wiederherstellen (Datenbank prod_local im Test-Container, Port 5433)
node scripts/prod-mirror/parity.mjs                  # Bericht: was Produktion hat und der Nachbau nicht kennt
LEGACY_DATABASE_URL=postgres://postgres:postgres@127.0.0.1:5433/prod_local \
  node backend/dist/migration/cli.js export --out backups/export-<datum> --storage-dir backups/prod-<zeit>/storage \
    --only-org <org-slug>      # Umfang laut Betreiberentscheidung (docs/migration/02 E37)
```

Der Export bricht bei **Tabellen ohne Zuordnung** mit `SCHEMA_DRIFT` ab (statt sie still wegzulassen); `--allow-unmapped <tabelle>` lässt eine
Tabelle bewusst aus. Danach geht es mit dem Probelauf aus `docs/betrieb/migration.md` §5 weiter.

## Was erfasst wird

| Quelle | Datei im Abzug | Zweck |
|---|---|---|
| Struktur und Zähler | `inventory/*.tsv` | Version, Erweiterungen, Tabellen (RLS, Policies), Publications, Trigger, Funktionen, Cron-Jobs (bereinigt), Buckets, Auth-Zähler, Hash-**Formate** (nur Präfix), Identitäten, Migrationsstand |
| Schema je Schema | `schema-<schema>.sql` | Vergleich/Replay (`public`, `auth`, `storage`, `realtime`, `supabase_functions`, `supabase_migrations`) |
| Daten | `prod-public.pgdump`, `prod-platform.pgdump` | `public` sowie `auth.users`, `auth.identities`, `storage.buckets/objects`, Migrationsstand |
| Konfiguration | `config/*.json` | Auth-Einstellungen, Funktionsliste (+ Rohdaten der Funktionen), Secret-Namen (best effort über die Management-API) |
| Storage | `storage/files/…` | Spiegel für `--storage-dir` des Exports |
| Protokolle | `capture.log`, `restore.log` | Fehler einzelner Objekte stehen hier und sind zu prüfen |

## Grenzen (ehrlich)

- **Nicht in der Datenbank und deshalb nur über die Management-API/Dashboard erfassbar:** Auth-Einstellungen (Provider, „Confirm email“, Mailvorlagen,
  Redirect-URLs), Realtime-Dienstkonfiguration, Edge-Function-Secrets (nur Namen), Webhooks außerhalb der Datenbank. Die API-Aufrufe sind
  *best effort* und wurden nicht gegen die echte Produktion getestet; ein Fehler steht im Protokoll und bricht nichts ab.
- **pg_cron/pg_net werden lokal nicht nachgebaut**: Die Jobs würden Produktionsadressen aufrufen. Das Inventar listet sie; Ersatz ist der Scheduler (E29).
- Die lokale Wiederherstellung ist ein Plain-PostgreSQL mit dem Plattform-Gerüst aus `backend/scripts/legacy-replay/stubs.sql`, **kein** `supabase/postgres`-Image.
  Das reicht für Export, Parität und Probelauf; Auth-/Storage-/Realtime-*Dienste* laufen nicht.
