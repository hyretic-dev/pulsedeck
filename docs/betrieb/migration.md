# Datenmigration und Cutover: Supabase → selbst gehostetes PulseDeck

Betriebsanleitung für die einmalige Übernahme des Supabase-Bestands (Datenbank, Konten, Dateien) und die Umschaltung.
Werkzeuge: `backend/src/migration/` (Export, Import, Validierung), `scripts/rehearse-migration.sh` (Probelauf auf isoliertem
Staging), `READ_ONLY` im Frontend-Container (schreibgeschützte Abnahme). Entscheidungen dazu: `docs/migration/02-…` E33–E36.

> **Wichtig:** Alles unten ist gegen den **rekonstruierten Altbestand** (Replay des Live-Schemas, Stand Juni 2026) mit
> repräsentativen Testdaten geprobt. Gegen die **echte Produktion** wurde nichts ausgeführt (kein Zugang in der Entwicklung).
> **Seit 2026-10-14 ist der Produktionsstand belegt und der Import mit den echten Daten geprobt** (89/89 Prüfungen, Dateiinhalte als Platzhalter) (`../migration/05-produktionsbefund.md`: Schema, Realtime, Cron, Buckets, Konten, Edge Functions — nur lesend per MCP). Es fehlen weiterhin Auth-Dienst-Einstellungen, Storage-Bytes (S3-Zugang) und ein echter Passwort-Login.
>
> Die Schritte, die Supabase selbst betreffen (Lesekonto, Storage-Spiegel, Schreibstopp, Stilllegung), sind deshalb als
> *„im Staging mit echten Daten zu verifizieren“* gekennzeichnet. Der Probelauf mit einem Produktions-Export ist Pflicht vor dem Cutover.

## 1. Ablauf in einem Satz

Export (nur lesend, konsistenter Schnappschuss) → Probelauf und Import auf Staging → Validierung → Backup/Restore-Probe →
**Cutover im Wartungsfenster** (Schreibstopp alt → finaler Export → Import → Validierung → schreibgeschützte Abnahme → Freigabe) →
Beobachtungsfrist → erst danach Supabase stilllegen.

## 2. Vorbedingungen (Checkliste, alles vor dem Cutover erledigt)

| # | Voraussetzung | Wer | Nachweis |
|---|---|---|---|
| 1 | **Lesender Zugang zur Supabase-Datenbank** (direkte Verbindung oder Pooler im Session-Modus) mit `SELECT` auf `public.*`, `auth.users`, `auth.identities`, `storage.buckets`, `storage.objects`. Ein eigenes Lesekonto ist sauberer als die Projektrolle; ob sich die Rechte auf dem `auth`-Schema vergeben lassen, ist im Staging zu prüfen | Betreiber | Export läuft, `SOURCE_PRIVILEGE` bleibt aus |
| 2 | **Spiegel des Supabase-Storage** (Bucket `files`) in einem lokalen Verzeichnis `<dir>/files/<storage_path>`, z. B. per rclone gegen den S3-kompatiblen Endpunkt des Projekts oder Supabase-CLI. Nicht geprobt | Betreiber | Export meldet 0 fehlende Dateien |
| 3 | Zielsystem läuft (Compose, leere Volumes), Migrationen angewandt, `SECRETS_ENCRYPTION_KEY` gesetzt | Betreiber | `docker compose ps` healthy |
| 4 | **VAPID-Schlüsselpaar** neu erzeugen und in `VAPID_*` eintragen (`npx web-push generate-vapid-keys`). Push war in Produktion nie aktiv (keine Abos, `05-produktionsbefund.md`), ein altes Schlüsselpaar muss nicht erhalten bleiben | Betreiber | `GET /api/v1/push/config` liefert den öffentlichen Schlüssel |
| 5 | **Mail-Anbieter** konfiguriert (O4) und ein echter Testversand erfolgt | Betreiber | Verifikationsmail kommt an |
| 6 | Entscheidungen: Plattform-Administrator für `--platform-admin`: **ausschließlich dem vom Betreiber benannten Konto** (Konto-ID nur lokal; Mitglied der übernommenen Organisation; Betreiberentscheidung 2026-10-15, E27 D1); Umfang = nur diese Organisation (E37), die Newsletter-Konfiguration geht automatisch an sie | Betreiber | Parameter für Export und Import |
| 7 | Wartungsfenster und Ansage an die Nutzer (O8), Rollback-Frist festgelegt | Betreiber | Termin |
| 8 | Neue native App-Builds (§7) sind in den Stores freigegeben | Betreiber | Store-Status |

### 2a. Produktionsstand lokal abziehen und gegen den Nachbau halten

Bevor ein Export geplant wird, den **tatsächlichen** Produktionsstand lokal erfassen — auch das, was im Repo nicht sichtbar ist (Dashboard-Tabellen,
Realtime-Publication, pg_cron-Jobs, Trigger auf `auth`, Buckets, Hash-Formate): `scripts/prod-mirror/` (Anleitung und Grenzen: `scripts/prod-mirror/README.md`).

```bash
bash scripts/prod-mirror/capture.sh      # Inventar, Schema, Daten (+ optional Management-API-Konfiguration, Storage-Spiegel) nach backups/
bash scripts/prod-mirror/restore.sh      # lokale Datenbank prod_local
node scripts/prod-mirror/parity.mjs      # Paritätsbericht: was Produktion hat und der Nachbau nicht kennt
```

Geprüft an einem prod-ähnlichen lokalen Stand: Dump → Wiederherstellung → Export ergibt für alle 33 Tabellen dieselben Prüfsummen wie der Export direkt aus der Quelle
(identische Dateiinhalte); der Paritätsbericht erkennt eingeschleuste Abweichungen (unbekannte Tabelle, zusätzliche Publication-Tabelle, Cron-Job, weiterer Bucket,
fremdes Hash-Format, Trigger auf `auth.users`). **Gegen die echte Produktion nicht ausgeführt** — dafür fehlen Zugangsdaten (Datenbank-Connection-String; optional Zugriffstoken und S3-Schlüssel).

## 3. Export (lesend)

```bash
cd backend && npm run build
LEGACY_DATABASE_URL='postgres://…@db.<projekt>.supabase.co:5432/postgres' \
  node dist/migration/cli.js export --out /pfad/export-2026-xx-xx --storage-dir /pfad/supabase-storage \
    --only-org <org-slug>
```

**Umfang (E37):** Übernommen wird nur die Organisation `<org-slug>`. `--only-org <slug>` beschränkt jede Tabelle auf ihre Daten; mitkommen die Konten der Mitglieder, die Besitzerin bzw. der Besitzer und Konten mit Chat-Verlauf der Organisation (weitere ausdrücklich per `--keep-account <uuid>`). Alles andere (Organisation eine weitere Organisation, die Testorganisation, Konten ohne Bezug) bleibt draußen und steht mit Grund im Manifest unter `excluded` bzw. `scope`.

- Eine einzige `REPEATABLE READ … READ ONLY`-Transaktion: alle Tabellen stammen aus demselben Schnappschuss, es wird nichts verändert.
- Ergebnis: je Tabelle `<tabelle>.ndjson`, `storage/<dateiId>` und `manifest.json` (Zeilenzahlen, kanonische Inhaltsprüfsummen
  inkl. Zeitstempel und Vektoren, Zählung je Organisation, ausgeschlossene Zeilen **mit Grund**, Vorabprüfung: Serverversion,
  Erweiterungen, Tabellengrößen, Buckets, Auth-Anbieter).
- Das Exportverzeichnis enthält Personendaten und Passwort-Hashes: wie ein Datenbank-Backup behandeln (Zugriff, Verschlüsselung, Löschung nach der Frist).
- Zugangsdaten stehen nur in der Umgebung; das Werkzeug gibt nur Host/Datenbankname aus.
- Tabellen der Quelle **ohne Zuordnung** in `tables.ts` lassen den Export mit `SCHEMA_DRIFT` abbrechen (nichts fällt still weg); `--allow-unmapped <tabelle>` lässt eine Tabelle bewusst aus und trägt das im Manifest ein.

**Exit-Codes** (alle Werkzeuge): `2` Aufruf, `10` Quelle nicht erreichbar, `11` Schemaabweichung, `12` Export beschädigt, `13` Dateiinhalt
fehlt (mit `--allow-missing-objects` bewusst fortsetzen), `14` fehlende Leserechte, `15` Ziel nicht erreichbar, `20` Ziel nicht leer,
`21` Constraint-/Datenfehler, `22` Checkpoint passt nicht zum Ziel, `23` Schlüssel fehlt, `24` Newsletter-Organisation unklar,
`25` Plattform-Administrator nicht im Export, `30` Validierung fehlgeschlagen, `1` unerwartet. Ein Fehlschlag meldet nie Teilerfolg.

## 4. Was beim Import mit den Daten passiert

| Quelle | Ziel | Umwandlung / Auslassung (jede im Importbericht gezählt) |
|---|---|---|
| `auth.users` | `auth_users` | UUID bleibt. E-Mail getrimmt und kleingeschrieben. **bcrypt-Hash (`$2a/$2b`) bleibt gültig** (Supabase-kompatibel). Kein nutzbarer Hash (OAuth/Magic-Link-Konten) → unbenutzbarer Hash, `password_set=false`. `email_confirmed_at` → `email_verified`. `banned_until` in der Zukunft → `is_blocked`. Plattform-Administratoren nur laut `--platform-admin`. **Nicht übernommen:** gelöschte Konten (`deleted_at`) und Konten ohne E-Mail. |
| übrige `public`-Tabellen | gleichnamig | unverändert (IDs, Beziehungen, Slugs, Rollen, Zeitstempel). Selbstbezüge (`folders.parent_id`, `events.recurrence_parent_id`) werden nach dem Einfügen gesetzt. |
| `newsletter_config` | `newsletter_config` | Die alte Konfiguration war **global** → wird der mit `--newsletter-org` genannten Organisation zugeordnet (bei genau einer Organisation automatisch; in Produktion gibt es 3 Organisationen, der Parameter ist also Pflicht); das **Klartext-SMTP-Passwort wird verschlüsselt** (AES-256-GCM, an die Organisation gebunden). |
| `files` + Bucket `files` | `files` + Volume `files-data` | `storage_path` wird `<orgId>/<dateiId>`; Inhalt wird mit SHA-256 und Größe geprüft kopiert. Der alte Pfad beginnt in Produktion mit `/` (`/<name>.pdf`), der Objektname im Bucket nicht — der Export entfernt führende Schrägstriche. **Nicht übernommen:** Dateien ohne Organisation; Objekte ohne Datenbankzeile (in Produktion 2, verwaist). |
| `knowledge_base` | `knowledge_base` | Nur Chunks **mit Dateibezug** (Vektoren bleiben, Herkunft `file`). Chunks aus Wiki/AG/Terminen erzeugt der nächtliche Job aus den Stammdaten neu. |
| `feedback_submissions` | gleichnamig | `type`/`status` auf die neuen Wertemengen abgebildet (unbekannt → `suggestion`/`new`, abgebildete Werte stehen im Bericht); `organization_id` aus der **einzigen** Mitgliedschaft des Kontos, sonst leer. |
| `push_subscriptions`, `feed_item_reads` | gleichnamig | beide existieren in Produktion **nicht** (Push nie aktiv, Juli-Migration nie eingespielt) und sind in der Registry optional; `feed_items` ohne `is_pinned` bekommt den Spaltenstandard `false`. |
| `active_sessions` | – | **bewusst nicht übernommen** (flüchtige Präsenz). |
| `storage` für `avatars`, Logos | – | Das Schema verweist nur auf URLs; der Export inventarisiert alle Buckets im Manifest. Verweise auf Supabase-Storage-URLs in Inhalten werden **nicht umgeschrieben** — im Staging mit `grep -r "supabase.co/storage" <export>/*.ndjson` prüfen. |

Der Import:

- prüft zuerst das Manifest (SHA-256 jeder Datei, jedes Dateiinhalts) und **berührt das Ziel nicht**, wenn etwas nicht stimmt;
- verlangt ein **leeres Ziel** (`20`), jede Tabelle in einer eigenen Transaktion (alles oder nichts), Checkpoint je Ziel (Datei `import-checkpoint-<ziel>.json` im Exportverzeichnis);
- kopiert die Dateien erst **nach** allen Tabellen (idempotent, Temp-Datei + `rename`);
- kennt einen **Probelauf** (`--dry-run`): alles gegen das echte Zielschema in einer zurückgerollten Transaktion.

**Wiederaufnahme nach Abbruch:** Ursache beheben und denselben Befehl erneut ausführen; fertige Tabellen werden übersprungen, **nur wenn das Ziel sie noch enthält** (sonst `22`). Neu anfangen: Zieldatenbank neu anlegen **und** die Checkpoint-Datei löschen.

## 5. Probelauf auf Staging (Pflicht, wiederholbar)

```bash
bash scripts/rehearse-migration.sh /pfad/export-2026-xx-xx \
  --platform-admin <Konto-ID>
```

Eigenes Compose-Projekt mit leeren Volumes und Wegwerf-Secrets, die Werkzeuge laufen aus dem Backend-Image: Migrationen → Probelauf →
Import → Validierung → `pg_dump` + Dateikopie → Restore in frische Datenbank → Validierung des Restores gegen dasselbe Manifest.
Exit 0 nur, wenn alles stimmt. Letzter Lauf (Altbestand-Replay mit repräsentativen Daten): alle Schritte `ok`, **93 Prüfungen im Import und 93 im Restore**.

Die **Validierung** vergleicht nicht nur Zeilenzahlen: Prüfsumme je Tabelle über alle Spalten (inkl. Zeitstempel und Vektoren), Zählung
je Organisation, alle Constraints/Indizes gültig, **keine verwaisten Fremdschlüssel** (alle FKs geprüft), Dateiinhalte (Größe + SHA-256),
`storage_path`-Schema, keine verwaisten Objekte im Volume, einheitliche Vektordimension, keine fachlichen Sequenzen.
Eigenständig ausführbar: `node dist/migration/cli.js validate --from <export>`.

Zusätzlich im Staging **von Hand** (nicht automatisierbar ohne Echtdaten):

1. **Echter Passwort-Login** mit einem Produktionskonto (Beleg, dass die Supabase-Hashes mit `bcryptjs` stimmen — bisher nur synthetisch geprüft).
2. Konto, das nur OAuth nutzte: „Passwort vergessen“ bzw. Magic-Link funktioniert (E-Mail gilt als bestätigt).
3. Je Rolle (Admin, Vorstand, Mitglied, Mitglied mehrerer Organisationen) die Hauptseiten öffnen: `cd e2e && node browser-smoke.mjs` für den Grundablauf, Rest manuell.
4. Newsletter-Testversand einer Organisation (Passwort-Entschlüsselung, SMTP des Betreibers).
5. Eine hochgeladene Datei herunterladen, eine Vorschau öffnen, eine Datei mit Sichtbarkeit `ag-only` als Nicht-Mitglied abrufen (404).
6. Kalender-Abo (§7) und Sitemap/robots.txt.
7. Laufzeit des Exports/Imports und Größe messen → Länge des Wartungsfensters ableiten.

### 5a. Lokale Kopie ansehen (ohne Cutover)

```bash
bash scripts/local-copy.sh start backups/export-<datum> --platform-admin <Konto-ID>   # eigenes Projekt pulsedeck-lokal, Port 8090
bash scripts/local-copy.sh stop | reset
```

Legt ein eigenes Compose-Projekt an, importiert den Export, validiert und startet die Oberfläche unter `http://localhost:8090`. Es verlässt nichts den Rechner: Mail-Transport `log` (Links stehen im Backend-Log), Hintergrundjobs aus, keine KI-Schlüssel; die Zugangsdatei `backups/lokal.env` enthält Wegwerf-Secrets und ist git-ignoriert. Angemeldet wird mit dem Produktionspasswort (Hashes sind übernommen) oder über „Passwort vergessen“.

## 6. Cutover-Plan (Wartungsfenster mit vollständigem Schreibstopp)

Gewählte Strategie: **Wartungsfenster mit Schreibstopp** statt Delta-Replikation (O8 muss mit dem Betreiber bestätigt werden; Delta-Replikation ist nicht umgesetzt).

| Schritt | Aktion | Prüfung / Abbruchkriterium |
|---|---|---|
| **T−7 Tage** | Probelauf (§5) mit frischem Produktions-Export bestanden; Ansage an Nutzer (Wartungsfenster, einmaliges erneutes Anmelden, Kalender-Abo/Push); App-Builds in den Stores | Probelauf nicht grün → Termin verschieben |
| **T−1 Tag** | Zielsystem produktiv konfiguriert (`docker-compose.prod.yml`, echte Secrets, TLS am Reverse Proxy); Backup-Verfahren geprobt; Rollback-Entscheidung benannt (wer, bis wann) | Mail-Testversand, Healthchecks, `smoke-compose.sh` grün |
| **T 0:00** | **Alten Schreibzugriff stoppen:** Wartungsseite für die alte Oberfläche; die Supabase-Schreibwege schließen (z. B. Datenbank des Projekts schreibgeschützt setzen oder die `anon`/`authenticated`-Schlüssel rotieren — **Verfahren im Staging verifizieren**); pg_cron-Jobs und Edge-Function-Aufrufer (Dashboard-Webhooks, Cron, `send-push`) abschalten; laufende Newsletter-Versände abwarten | Prüfen, dass kein Write mehr ankommt (`audit_logs`/`updated_at` der Quelle bleibt stehen) |
| **T 0:15** | **Finaler Export** (§3) mit frischem Storage-Spiegel; `manifest.json` und Exit-Code sichern | Exit ≠ 0 → Abbruch, alte Plattform wieder öffnen |
| **T 0:30** | Import (§4) in die **leere** Produktions-Datenbank; **`READ_ONLY=true`** im Frontend-Container; danach `validate` | Jede fehlgeschlagene Prüfung → Abbruch (§8) |
| **T 1:00** | **Schreibgeschützte Abnahme** mit echten Konten (Login möglich, Schreiben liefert 503 `read_only`): Smoke je Rolle (§5, Punkte 1–6), öffentliche Seiten, `sitemap.xml` | Smoke rot → Abbruch |
| **T 1:30** | **Freigabe:** `READ_ONLY=false`; DNS/Proxy auf das neue System (oder bereits dort); Mails/Push aktivieren; Backup des Ziels sofort ziehen (Ausgangspunkt nach Freigabe) | |
| **T+1 bis T+14 Tage** | Beobachtung: Fehlerquote (Zugriffslog `status`), Mail-Outbox, Push, Login-Fehler, Speicher; tägliches Backup (DB + `files-data`) | Abbruchkriterien siehe §8 |
| **nach Abnahme** | Supabase **nur nach ausdrücklicher Freigabe** stilllegen (§9) | |

## 7. Folgen für Nutzer und Clients (Dokumentierte Auswirkungen)

- **Alle müssen sich einmal neu anmelden.** Supabase-Refresh-Tokens sind keine Sitzungen des neuen Backends (andere Signatur, andere Speicherung); die neue Oberfläche speichert ihre Sitzung unter anderem Schlüssel und kennt die alte nicht. Passwörter bleiben (Hash-Übernahme).
- **Konten ohne Passwort** (in Produktion 4, eingeladen) melden sich mit Magic-Link oder „Passwort vergessen“ an. OAuth-Identitäten gibt es in Produktion nicht (nur `email`, 17 von 17), die fehlende OAuth-Umsetzung (O5) verliert nichts; das Manifest nennt die Identitäten in `source.authProviders`.
- **Versandte Einladungs-, Verifikations- und Reset-Links der alten Plattform sind ungültig.** Offene Einladungen (Mitglieder mit Status `Pending` ohne Konto) neu verschicken (`POST /orgs/:orgId/members/:id/invite`); bei erster Anmeldung mit bestätigter E-Mail werden Mitglied und Konto verknüpft.
- **Kalender-Abos:** Das Token (`members.calendar_token`) bleibt erhalten, aber die Adresse ändert sich von `…supabase.co/functions/v1/ical-export?token=…` auf `https://<instanz>/api/v1/public/ical?token=…`. Abonnierte externe Kalender müssen **neu eingerichtet** werden (Edge Function weiterlaufen lassen, solange das gewünscht ist: sie liest dann den eingefrorenen Stand).
- **Web-Push:** In Produktion war Push nie aktiv; es gibt nichts zu übernehmen. Nutzer aktivieren Benachrichtigungen erstmals nach dem Cutover.
- **Installierte PWAs/gecachte Bundles:** `index.html` und `ngsw.json` werden nicht lang gecacht; der Service Worker lädt beim nächsten Start die neue Version. Ein altes Bundle, das noch gegen Supabase spricht, wird mit Supabases Schreibstopp (T 0:00) wirkungslos — deshalb Supabase bis zum Ende der Rollback-Frist nicht löschen und die Ansage vorher.
- **Native Apps (Capacitor):** Das Bundle steckt in der App; alte Store-Versionen sprechen weiter mit Supabase. Neue Builds **vor** dem Cutover freigeben: `PULSEDECK_API_URL=https://<instanz> npm run build:mobile && npx cap sync`; im Backend `CORS_ORIGINS=https://localhost,capacitor://localhost` setzen. **Nicht auf einem echten Gerät geprobt** — Ursprung und Ablauf im Staging mit einem Test-Build prüfen.
- **Realtime** läuft per SSE; ein Reverse Proxy vor nginx muss Pufferung für `/api/v1/orgs/*/realtime` und `/chat` abschalten (nginx.conf tut es für den eigenen Block).

## 8. Abbruch und Rollback

- **Vor der Freigabe (T 1:30)** hat das Zielsystem keine eigenen Schreibzugriffe (Abnahme schreibgeschützt, nur Sitzungen/Token durch Logins). Rollback = Wartungsseite weg, Supabase-Schreibwege wieder öffnen, Zielsystem verwerfen. **Verlustfrei**, weil die Quelle seit T 0:00 unverändert ist.
- **Nach der Freigabe** gibt es neue Daten im Ziel (Mitglieder, Beiträge, Uploads, Passwortänderungen, versandte Mails). Ein **Zurückschalten auf Supabase verliert diese Daten**; eine Rückführung ins alte System ist **nicht** umgesetzt. Entscheidung deshalb **nur innerhalb der Abnahme (vor der Freigabe)**; danach nur noch vorwärts reparieren (Fehler im Ziel beheben, aus Backups wiederherstellen).
- **Abbruchkriterien vor Freigabe:** Validierung rot; Export-/Import-Exit ≠ 0; Smoke einer Rolle rot; echter Passwort-Login schlägt fehl; Dateiabruf liefert Fehler; Mail-Testversand scheitert.
- **Nach der Freigabe (Beobachtung):** Fehlerquote 5xx über 2 % über 15 Minuten, Login funktioniert für Bestandskonten nicht, Datenverlust gemeldet → Entscheidung des Betreibers: Reparatur vorwärts oder Rücksprung mit bewusstem Verlust der neuen Daten.

## 9. Stilllegung (erst nach Freigabe des Betreibers)

**Hinweis:** In Produktion läuft eine nicht im Repo geführte, öffentlich aufrufbare Altlast-Funktion (Details nur lokal, `05-produktionsbefund.md` Befund 1, O20). Sie entfällt mit der Stilllegung von Supabase; bis dahin ist sie ein bekanntes Restrisiko.

Supabase-Projekt erst löschen/pausieren, wenn: Rollback-Frist abgelaufen, keine alten Clients mehr zugreifen (Store-Versionen, PWAs), Kalender-Abos umgezogen, das Zielsystem mindestens ein vollständiges Backup/Restore bestanden hat (`scripts/rehearse-migration.sh` bzw. die Befehle aus `selfhosting.md`), und die Betreiber-Freigabe vorliegt. Danach alte Schlüssel widerrufen (Supabase-Service-Role, Resend-Key falls ersetzt, VAPID nur bei Wechsel), das Repo-Verzeichnis `supabase/` und die Edge-Function-Quellen entfernen.
