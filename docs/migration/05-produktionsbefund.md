# Produktionsbefund (Supabase) — Stand 2026-10-14

Erstmals **am echten Produktionssystem** belegt, was bisher nur aus dem Repo und dem Juni-Dump abgeleitet war (`02-…` „Produktive Parität — noch nicht belegt“).

**Wie erhoben:** Supabase-MCP mit `read_only=true` (nur lesende Abfragen), Abfragen aus `scripts/prod-mirror/inventory.sql` plus gezielte Zählabfragen. Gelesen wurden **nur Strukturen, Namen und Zähler** — keine Zeilen, keine E-Mail-Adressen, keine Hashes, keine Dateinamen. Die Rohdaten liegen lokal in `backups/mcp-inventory/` (git-ignoriert).
**Nicht erfasst** (der MCP bietet es nicht): Einstellungen des Auth-Dienstes (aktive Provider, „Confirm email“, Mailvorlagen, Redirect-URLs), Edge-Function-Secrets, Realtime-Dienstkonfiguration, Storage-Inhalte (Bytes) und eine vollständige Datensicherung. Dafür braucht es weiterhin Management-API-Token, S3-Schlüssel und den Datenbank-Connection-String (`scripts/prod-mirror/README.md`).

## Fakten

| Bereich | Befund |
|---|---|
| Datenbank | PostgreSQL **17.6**, 26,9 MB; Erweiterungen `pg_cron` 1.6.4, `pg_net` 0.19.5, `pgcrypto`, `uuid-ossp`, `vector` 0.8.0, `supabase_vault`, `pg_stat_statements` (lokal PostgreSQL 17 + pgvector, passend) |
| Tabellen `public` | **31** — dieselbe Struktur wie unser Replay (**30 von 31 identisch** per Spaltenabdruck). Abweichung: `feed_items` hat **keine Spalte `is_pinned`**; **`feed_item_reads` existiert nicht** (Juli-Migration nie eingespielt). `push_subscriptions` und `push_notification_queue` **existieren nicht** |
| Zeilen | active_sessions 3, ag_memberships 8, analytics_events 379, audit_logs 275, chat_messages 132, chat_sessions 69, contacts 3, event_registrations 5, event_slot_signups 3, event_slots 3, events 8, feed_items 10, feedback_submissions 19, files 9, folders 2, knowledge_base 154, member_skills 16, members 9, newsletter_config 1, onboarding_progress 13, organization_roles 12, organizations 3, poll_options 4, poll_votes 1, skills 63, user_tasks 2, wiki_categories 11, wiki_docs 17, working_group_members 2, working_groups 4 (event_guest_organizations 0) |
| Konten | 17 (0 gelöscht, 0 gesperrt); **13 mit bcrypt `$2a$10`** (gleicher Algorithmus und Kostenfaktor wie unser Hasher), 4 ohne Passwort; 10 bestätigt, **7 unbestätigt** (3 davon mit Passwort, nie angemeldet; 4 ohne Passwort); **Identitäten ausschließlich `email` (17)** — keine OAuth-Konten; 10 Konten eingeladen; **kein Konto in den letzten 30 Tagen angemeldet** |
| Mitglieder | 9, alle mit Konto verknüpft; **0 Verstöße** gegen die neuen Constraints (Mehrfachmitgliedschaft je Konto/Organisation, doppelte E-Mail je Organisation, Rolle aus fremder Organisation, fehlendes Konto) |
| Organisationen | 3, 2 verschiedene Besitzer, alle mit Besitzer |
| Realtime | Publication `supabase_realtime` mit **7 Tabellen**: contacts, events, feedback_submissions, members, wiki_docs, working_group_members, working_groups (alle in `REALTIME_TABELLEN`; `event_registrations`, das der Kalender abonnierte, ist **nicht** publiziert). Die zweite Publication gehört der Plattform (`realtime.messages_*`) |
| pg_cron | **1 Job** `invoke-ingest-docs-daily`, Zeitplan **`*/10 * * * *`** (alle 10 Minuten, trotz „daily“), ruft `ingest-docs` ohne Schlüssel per `net.http_get` |
| Trigger (Anwendung) | wie im Juni-Dump; zusätzlich auf `auth.users`: `on_auth_user_link_members` → `handle_new_user_linking()` (ersetzt, E23) |
| Storage | Bucket `files` privat: **11 Objekte, 3,2 MB**, flach (kein Organisationspräfix); Bucket `avatars` öffentlich, **0 Objekte**. `files.storage_path` beginnt mit **`/`** (`/<name>.pdf`), der Objektname nicht; 9 Zeilen finden je ein Objekt, **2 Objekte ohne Zeile** (verwaist); 0 Dateien ohne Organisation; Sichtbarkeit member 6, ag-only 3 (keine `public`) |
| Wissensbasis | 154 Chunks (126 mit Datei, **24 ohne Organisation** = globale Dokumentation), alle mit Vektor, **1024 Dimensionen** |
| Feedback | 19: `bug`/`new` 15, `suggestion`/`new` 4 — keine Wertabbildung nötig |
| Newsletter | **1 globale Konfiguration**, inaktiv, `weekly`, mit SMTP-Host, **Klartext-Passwort** und Logo |
| Events | 8, davon 1 Serie |
| Migrationsstand | 13 Versionen in der Historie (ab 20260117); 16 Repo-Migrationen stehen nicht darin (Basis- und Dashboard-Änderungen; die Struktur stimmt trotzdem, s. o.) |
| Edge Functions | **11 bereitgestellt**: invite-member, delete-auth-user, ical-export, send-invitation, generate-magic-link, sitemap, send-newsletter, chatbot, ingest-docs, ingest-file, **eine weitere, nicht im Repo geführte Funktion (O20)**. **Nie bereitgestellt:** `send-push`, `send-event-notification`, `send-guest-invitation` |

## Befunde und Folgen

1. **Altlast in Produktion (Details nur lokal, O20):** Eine nicht im Repo geführte, öffentlich aufrufbare Edge Function (ohne JWT-Prüfung) läuft mit der Service-Rolle. Geprüft: aktuell kein Datenzugriff möglich. **Betreiberentscheidung 2026-10-14:** keine Maßnahme, weil Supabase komplett entfernt wird (Restrisiko bis zur Stilllegung). Sie wird nicht migriert; der Paritätsbericht führt sie als Abweichung (`parity.mjs`).
2. **Dateipfade (behoben, Test).** Der Export hätte wegen des führenden `/` alle neun Dateien als „fehlend“ gemeldet (`STORAGE_OBJECT_MISSING`). Der Exporter entfernt führende Schrägstriche; Pfade aus dem Bucket heraus werden weiter abgewiesen (zwei Tests, Mutationen erkannt). Zwei verwaiste Objekte werden nicht übernommen.
3. **`feed_item_reads` und `is_pinned` fehlen (behoben, Test).** `feed_item_reads` ist in der Registry optional; `feed_items` ohne `is_pinned` importiert über den Spaltenstandard `false`. Die Test-Fixture bildet jetzt die Produktionsform nach (Tabelle und Spalte entfernt).
4. **Push, Gast-Einladungs-Mails und Termin-Benachrichtigungen waren in Produktion nie aktiv** (Edge Functions nie bereitgestellt, Tabellen nie angelegt). Es gibt **keine Push-Abos zu übernehmen**, und die VAPID-Schlüssel sind frei wählbar (O13/`migration.md` entsprechend vereinfacht). D8 ist damit beantwortet: Push ist neue Funktionalität, kein Bestand.
5. **OAuth (O5):** Es gibt keine einzige Provider-Identität. Die fehlende OAuth-Umsetzung verliert nichts.
6. **Anmeldung nach dem Cutover (E19):** Von 13 Passwort-Konten sind 10 bestätigt (melden sich wie gewohnt an), 3 unbestätigte haben sich nie angemeldet. Die 4 Konten ohne Passwort nutzen Magic-Link/Einladung. Die E19-Strenge trifft praktisch niemanden. Bcrypt-Format und Kostenfaktor stimmen; ein echter Login-Test mit einem Produktionskonto bleibt Pflicht im Staging.
7. **Realtime:** Unser Angebot (22 Tabellen) ist eine Obermenge der in Produktion publizierten 7. Der Kalender lauschte auf `event_registrations`, das in Produktion nie publiziert war — dort kamen also nie Ereignisse an; bei uns schon.
8. **Cron alle 10 Minuten:** In Produktion wird die Wissensbasis (global) alle 10 Minuten neu eingelesen. Unser Scheduler tut das täglich (E29) und nur bei geänderten Inhalten (Hash). Bewusste Abweichung; falls kürzere Aktualisierung gewünscht ist, ist es eine Zeitplan-Einstellung.
9. **Newsletter:** Eine globale Konfiguration, drei Organisationen → der Import verlangt `--newsletter-org <uuid>` (Betreiber-Entscheidung, welche Organisation sie erhält); das Klartext-Passwort wird verschlüsselt. Die Konfiguration ist inaktiv — es geht nichts verloren, wenn sie vorerst unzugeordnet bleibt (`--skip-newsletter` ist nicht umgesetzt: dann Konfiguration einer Organisation zuweisen und dort deaktiviert lassen).
10. **Datenvolumen:** 26,9 MB und 11 Dateien — Export, Import und Validierung dauern Sekunden; das Wartungsfenster wird von den Abnahmeschritten bestimmt, nicht von der Datenmenge.
11. **Nutzung:** Kein Konto war in den letzten 30 Tagen angemeldet. Ein Cutover trifft aktuell keine aktiven Nutzer; das senkt das Risiko und erlaubt ein kurzes Fenster. (Befund, keine Bewertung der Produktentscheidung.)

## Vollständiger Abzug und Probelauf mit echten Daten (2026-10-14)

Mit Datenbank-Zugang (Rolle `postgres`, nur lesend) wurde `scripts/prod-mirror/capture.sh` gegen die Produktion gefahren: Inventar, Schema (`public`, `auth`, `storage`, `realtime`, `supabase_migrations`) und Daten (`public` plus `auth.users`, `auth.identities`, `storage.*`). Der Abzug liegt lokal in `backups/prod-<zeit>/` (git-ignoriert, Rechte 700); die Wiederherstellung steht als **lokale Kopie** in der Datenbank `prod_local` des Test-Containers (Port 5433).

| Schritt | Ergebnis |
|---|---|
| Wiederherstellung | 31 Tabellen, 17 Konten, 11 Objekt-Metadaten, 7 Realtime-Tabellen; übrig nur plattforminterne Trigger (Plattformfunktionen fehlen lokal) |
| Paritätsbericht am echten Abzug | deckt sich mit den MCP-Befunden; **eine** Abweichung: die unbekannte Funktion (O20) |
| Export aus der lokalen Kopie | 33 Tabellen; 9 Dateien (Pfade mit führendem `/` korrekt aufgelöst); Wissensbasis 126 Chunks übernommen, 28 ausgeschlossen (24 ohne Organisation, übrige ohne Dateibezug) |
| Probelauf `rehearse-migration.sh` (Probelauf, Import, Validierung, `pg_dump` + Dateikopie, Restore, Validierung) | **bestanden: 89 von 89 Prüfungen im Import, 89 von 89 im Restore.** Umwandlungen: 10 bestätigte E-Mails, 4 Konten ohne Passwort (unbenutzbarer Hash, `password_set=false`), 1 Plattform-Administrator, Newsletter-Passwort verschlüsselt, Feedback: 16 mit abgeleiteter Organisation, 3 ohne |
| Passwort-Hashes | alle 13 als bcrypt lesbar, Kostenfaktor 10 (`bcryptjs`, nur Format — ein echter Login mit bekanntem Passwort steht aus) |

### Umfang: nur eine Organisation (E37)

Betreiberentscheidung: Nur die Organisation `<org-slug>` wird übernommen; eine weitere Organisation (2 Mitglieder, 2 Termine, 1 Wiki-Seite, 3 Beiträge) und eine Testorganisation (1 Mitglied) nicht. Export mit `--only-org <org-slug>`: **6 von 17 Konten** (5 Admins, 1 Mitglied; alle echt wirkend, keine Testadressen), 1 Organisation, 6 Mitglieder, 21 Skills, 3 Arbeitsgruppen, 16 Wiki-Seiten, 6 Termine, 7 Beiträge, 9 Dateien, 126 Wissens-Chunks, 69 Chat-Sitzungen mit 132 Nachrichten, 8 Analytics-Ereignisse (371 ohne Organisation ausgeschlossen), 216 Audit-Einträge, 3 Feedback-Einträge (16 von Konten außerhalb des Umfangs ausgeschlossen). Ausgeschlossen sind damit auch **2 Konten nur in anderen Organisationen und 9 Konten ohne jede Mitgliedschaft** (u. a. die Testkonten). Probelauf mit diesem Umfang: **89 von 89 Prüfungen im Import und im Restore**; 4 bestätigte E-Mails, 2 Konten ohne Passwort, 1 Plattform-Administrator, Newsletter-Passwort verschlüsselt und automatisch der einzigen Organisation zugeordnet.

Nicht übernommene Geheimnisse: `members.connection_token` ist in Produktion nie gesetzt (0 von 9), `calendar_token` (9 von 9) bleibt erhalten, damit Kalender-Tokens gültig bleiben.

**Einschränkungen dieses Laufs:** (1) Die **Dateiinhalte sind Platzhalter** unter den echten Pfaden (`backups/standin-storage/`): Zugang zu den Storage-Bytes (S3-Schlüssel) fehlt, die Byte-Prüfungen des Imports sind damit nur für den Mechanismus aussagekräftig. (2) Der erste Lauf (alle drei Organisationen) brauchte `--newsletter-org`; mit E37 entfällt das. (3) Plattform-Administrator ist ausschließlich `<Betreiber-E-Mail>` (Betreiberentscheidung 2026-10-15; E27 D1). Das ist das Konto `2d8af6a7…`, also dieselbe Person wie die früher fest einkodierte „Super Admin“-UUID; es ist Mitglied und Besitzer von die übernommene Organisation.

## Was damit belegt und was weiter offen ist

Belegt: Schemaparität (bis auf zwei dokumentierte Abweichungen), Realtime-Abdeckung, Hash-Format, Datenvolumen, Constraint-Verträglichkeit der Mitglieder, Wissensbasis-Dimension, Feedback-Werte, keine OAuth-/Push-Bestände.
**Weiter offen (O13):** echter Passwort-Login mit einem Produktionskonto (Format ist belegt), **Storage-Bytes** (S3-Spiegel), Auth-Dienst-Einstellungen („Confirm email“, Provider, Mailvorlagen, Redirect-URLs) und Secret-Namen (Management-API-Token). Vollständiger Datenabzug und Probelauf des Imports gegen die echten Daten sind **erledigt** (s. o.).
