# Rechte-Matrix und Befunde zum Bestand (Autorisierung und Mandantentrennung)

> **Hinweis (2026-10-15):** Pfade der Form `supabase/…` und `supabase_schema.sql` verweisen auf das aus dem Repo **entfernte** Verzeichnis (Rückbau, E38). Den Stand davor zeigt `git show 9b44e20:<pfad>`; die Migrationsversionen und Edge-Function-Namen stehen eingefroren in `scripts/prod-mirror/legacy-repo.json`.

Stand 2026-10-14. Grundlage für Gesamtauftrag §6/§7 und den Folgeschritt „Phase 1 Rest“. Die Matrix hält fest, **was im Bestand tatsächlich gilt**, was davon nicht übernommen wird und welche Regel im NestJS-Backend an die Stelle tritt. Sie ist erst verbindlich, wenn der Betreiber die offenen Punkte in §5 entschieden hat (Status „Vorschlag“).

## 1. Quelle und Grenzen

Das Repo enthält **kein** eigenständig lauffähiges Schema: In `supabase/migrations/` fehlen `organizations`, `feed_items` und `newsletter_config` (kein `CREATE TABLE` im aktuellen Baum; in der Git-Historie nur im Live-Dump des Commits `0d4978f`). Das Basisschema liegt als `pg_dump` der **Live-Datenbank** nur im Git-Commit `0d4978f` (2026-06-15, `supabase/migrations/20260612000000_init.sql`, 110 KB, später wieder entfernt).

Rekonstruktion (`backend/scripts/legacy-replay/`, reproduzierbar mit `node scripts/legacy-replay/replay.mjs` im Test-Container):

1. Plattform-Stubs (`stubs.sql`: Rollen `anon`/`authenticated`/`service_role`, `auth.uid()`, `auth.users`, `storage.*`, `cron`/`net`-Stubs).
2. Live-Dump aus Git `0d4978f`.
3. Danach erschienene Migrationen: `20260613000000_storage_policies.sql` (Git `0d4978f`) und `20260716150000_feed_pinned_reads.sql`.

Der Replay lief fehlerfrei (3 Schritte, 0 Fehler). Die inkrementellen Migrationen allein lassen sich **nicht** abspielen (28 von 42 Dateien scheitern an fehlenden Basistabellen).

**Grenzen:** Das Ergebnis bildet den Stand der Datenbank zum Dump (Juni 2026) plus zwei Migrationen ab. Änderungen, die später direkt im Dashboard vorgenommen wurden, sowie Objekte im Schema `auth` (u. a. der Trigger `handle_new_user_linking`) und die Realtime-Publication sind nicht enthalten. Die Produktionsparität ist damit weiterhin **nicht** belegt (O1: Zugang vorhanden, Export steht aus).

## 2. Belegte Zahlen (ersetzen die bisherigen Zählwerte)

| Objekt | Bestand (Replay) | frühere Angabe |
|---|---|---|
| Tabellen in `public` | **32** (alle mit RLS) | 31 |
| Policies `public` / `storage` | **126** / **7** | „101“ |
| eigene Funktionen (ohne pgvector) | **24**, davon 19 `SECURITY DEFINER`, 2 Debug-Funktionen `test_get_role`, `test_get_role_v2` | 25 |
| Trigger in `public` | **14** | 17 bzw. 19 |
| Trigger auf `auth.users` | nicht im Dump (Schema `auth` fehlt) | – |
| Realtime-Publication | nicht im Dump | – |

Weitere belegte Abweichungen zur bisherigen Matrix:

- **`push_subscriptions` und `push_notification_queue` fehlen im Live-Dump**, obwohl die Migrationen vom März sie anlegen und das Frontend `push_subscriptions` abfragt. Entweder wurden diese Migrationen nie ausgeführt (Push in Produktion dann nicht funktionsfähig) oder erst nach Juni. Zu prüfen am Live-System.
- **`wiki_categories`** existiert (32. Tabelle), wird aber vom Frontend nie über `from('wiki_categories')` angesprochen; `knowledge_base` wird nur von Edge Functions genutzt.
- **`has_slot_capacity` und `get_slot_signup_count` existieren im Live-Dump nicht.** Die Matrix führte sie als Kapazitätsprüfung für Helferslots. Im Live-Schema gibt es damit keinen DB-seitigen Überbuchungsschutz für `event_slot_signups`.
- **`active_sessions` hat keine `organization_id`.** Presence ist im Bestand nicht mandantenfähig modelliert.
- **`members.role_id` ist `NOT NULL`** (FK `RESTRICT`) und verweist auf `organization_roles`; nichts erzwingt, dass die Rolle zur gleichen Organisation gehört.

## 3. Wie der Bestand tatsächlich wirkt

Policies derselben Tabelle und desselben Befehls sind in PostgreSQL **permissiv und werden mit ODER verknüpft**. Die wirksame Regel ist also die großzügigste. Mehrere Tabellen tragen sowohl eine strenge Absicht („Admins verwalten …“) als auch eine offene Policy (`USING (true)`); die offene gewinnt.

Die Wirkung wurde als Rolle `anon` und `authenticated` im Replay ausgeführt (`backend/scripts/legacy-replay/probe-permissions.sql`, alles in einer zurückgerollten Transaktion):

| Probe | Ergebnis im Bestand |
|---|---|
| A2 anonym liest `active_sessions` (fremde Org) | 1 Zeile sichtbar |
| A4 anonym löscht `contacts` | 1 Zeile gelöscht |
| A5 anonym ändert `events` | 1 Zeile geändert |
| A6 anonym löscht `working_groups` | 1 Zeile gelöscht |
| A7 anonym legt ein Event in fremder Org an | erfolgreich |
| B1 normales Mitglied (Org 1) liest `files` einer fremden Org (Sichtbarkeit `member`) | 1 Zeile sichtbar |
| B2 dasselbe Mitglied liest Storage-Objekte der fremden Org (Bucket `files`) | 1 Objekt sichtbar |
| B3 dasselbe Mitglied legt eine Datei in der **fremden** Org an | erfolgreich |
| B5 Mitglied setzt sich selbst `app_role = 'admin'` und `permissions` | erfolgreich |
| B7/B8 dasselbe Mitglied setzt `organization_id` auf die fremde Org | erfolgreich, danach `is_admin_of_org(fremde Org) = true` |

Konsequenz: **Die Bestands-RLS ist keine tragfähige Vorlage für die Soll-Matrix.** Die Soll-Regeln folgen der erkennbaren Absicht der strengeren Policies, nicht der Wirkung der offenen.

Strukturelle Ursachen:

- `get_my_role()` und die einparametrige `has_permission(key)` lesen `members WHERE user_id = auth.uid()` **ohne Organisationsbezug**. Bei Mehrfachmitgliedschaft entscheidet eine beliebige Zeile; Policies mit `get_my_role()` (z. B. `working_group_members`, `feed_item_reads`, `contacts`) sind nicht mandantensicher.
- Die UPDATE-Policy auf `members` erlaubt `user_id = auth.uid()` ohne Spaltenbeschränkung.
- `analytics_events` vergleicht `auth.uid()` mit `members.id` (nie wahr); `audit_logs`, `analytics_events`, `feedback_submissions` sind nur für eine **fest einkodierte UUID** (`2d8af6a7-…`, „Super Admin“) lesbar.
- `files` trägt 11 überlappende Policies; die offenste (`auth.uid() IS NOT NULL`) bestimmt das Ergebnis.
- Storage: Jedes angemeldete Konto darf im Bucket `files` lesen, hochladen, ändern, löschen, unabhängig von der Organisation.

## 4. Matrix je Tabelle

Vokabular der Soll-Spalte: **Org-Mitglied** = geprüfte Mitgliedschaft in der Organisation (OrgGuard); **Org-Admin** = Besitzer, System-Admin-Rolle oder `app_role = admin` (`isAdmin`); **committee+** = `app_role` committee oder Org-Admin; **Recht X** = `hasPermission(X)` (siehe §6). Die Soll-Spalte ist ein **Vorschlag**; „umgesetzt“ bedeutet implementiert und mit Negativtest gegen echtes PostgreSQL belegt.

| Tabelle | Bestand (effektiv) | Befund | Soll im NestJS (Vorschlag) | Stand |
|---|---|---|---|---|
| `organizations` | lesen: **alle inkl. anonym, alle Spalten**; anlegen: jedes Konto (Policy ohne Prüfung von `owner_id`); ändern: Besitzer/Org-Admin | `owner_id`, `subscription_tier`, `max_members` öffentlich; Organisation mit fremdem Besitzer anlegbar | öffentliche Sicht nur als eigenes DTO (Name, Slug, Logo, Beschreibung, Farbe, Branding); Anlegen nur mit Aufrufer als Besitzer; ändern Org-Admin | **umgesetzt** — Anlegen atomar (Besitzer, Standardrollen/-skills), Einstellungen nur Admin, öffentliche Seite (`organizations.integration.spec.ts`) |
| `organization_roles` | lesen: Org-Mitglieder; verwalten: Besitzer/Org-Admin | passt zur Absicht | wie Bestand | **umgesetzt** — lesen für Mitglieder, verwalten nur Admin (`tenancy.integration.spec.ts`, `members.integration.spec.ts`) |
| `members` | lesen: Mitglieder der Org, Besitzer, eigene Zeile; anlegen/löschen: Org-Admin; ändern: Org-Admin **oder eigene Zeile, alle Spalten** | belegt: Selbst-Beförderung, Org-Wechsel (B5–B8); Rolle einer fremden Org zuweisbar | eigene Zeile nur Profilfelder; `app_role`, `role_id`, `permissions`, `organization_id`, `user_id`, `status`, `connection_token` nur Org-Admin; Besitzer-/Letzter-Admin-Schutz im Service; Rolle muss zur Org gehören | **umgesetzt** — Verbund-FK/Unique, Anlegen, Rollenwechsel, Besitzerschutz, letzter Admin, Import, Mehrfachlöschung, Einladung (`members.integration.spec.ts`, `auth.invitations.integration.spec.ts`) |
| `skills`, `member_skills` | lesen Org-Mitglieder; verwalten Org-Admin bzw. eigene | passt | wie Bestand | **umgesetzt** (`skills.integration.spec.ts`) |
| `working_groups` | lesen: **alle**; anlegen/ändern/löschen: **alle inkl. anonym** (`true`) | belegt: anonym löschbar (A6) | lesen Org-Mitglieder (öffentliche AGs: D4); schreiben Org-Admin oder AG-Leitung | **umgesetzt** (`working-groups.integration.spec.ts`) |
| `working_group_members` | lesen: jede Rolle `member`+ **irgendeiner** Org; anlegen/löschen: Admin einer beliebigen Org oder Selbst | org-übergreifend, `get_my_role()` | org-gebunden; Selbst-Beitritt nur für AGs der eigenen Org; verwalten AG-Leitung/Org-Admin | **umgesetzt** (`working-groups.integration.spec.ts`) |
| `ag_memberships` | lesen: **alle inkl. anonym**; Beitritt/Austritt eigene `member_id` (jede AG); ändern: Org-Admin einer Org oder AG-Admin/Lead | anonym lesbar; Beitritt in fremde AG | lesen Org-Mitglieder; Beitritt nur eigene Org; Rollenänderung AG-Leitung/Org-Admin | **umgesetzt** (`working-groups.integration.spec.ts`); beide Mitgliedschaftstabellen bleiben getrennt |
| `events` | lesen: **alle** (`events_public_read true`); anlegen/ändern/löschen: **alle inkl. anonym** | belegt: A5, A7 | lesen: öffentlich nur wenn `allowed_roles` `public` enthält, sonst Org-Mitglied mit passender Rolle; schreiben: Recht `events:create`/committee+/Org-Admin | **umgesetzt** inkl. Sichtbarkeit je Rolle/AG und öffentliche Termine (`events.integration.spec.ts`) |
| `event_registrations` | lesen: **alle inkl. anonym**; schreiben: eigene `member_id` | Anmeldungen jeder Org öffentlich | lesen Org-Mitglieder der Event-Org (Gast-Org: D4); schreiben nur eigene, nur für Events der eigenen Org | **umgesetzt** (`events.integration.spec.ts`) |
| `event_slots` | lesen Org-Mitglieder; verwalten admin/committee der Org | passt | wie Bestand | **umgesetzt** (`events.integration.spec.ts`) |
| `event_slot_signups` | lesen Org-Mitglieder; verwalten admin/committee; **eigene beliebige Slots** (`ALL` ohne Org-Prüfung des Slots) | keine Kapazitätsprüfung in der Live-DB | Slot muss zur Org des Mitglieds gehören; Kapazität per Constraint/Sperre in einer Transaktion | **umgesetzt** inkl. Kapazität atomar (`events.integration.spec.ts`) |
| `event_guest_organizations` | verwalten: admin/committee der Host-Org; lesen: Host-/Gast-Org-Mitglieder; öffentlich, wenn `accepted` und Event `public` | passt zur Absicht | wie Bestand | **umgesetzt** (`events.integration.spec.ts`) |
| `contacts` | lesen: **alle**; anlegen/ändern/löschen: **alle inkl. anonym** (`true`) | belegt: A4 | lesen Org-Mitglieder (globale Kontakte `organization_id IS NULL`: alle Mitglieder); schreiben Recht `contacts:edit` oder Org-Admin; globale nur Plattform-Admin (D1) | **umgesetzt** — lesen Mitglieder, ändern nach Recht `contacts:edit` (`contacts.integration.spec.ts`) |
| `feed_items` | lesen/schreiben org-gebunden über admin/committee, Autor, Recht `feed:create`; öffentlich, wenn `is_public` und `approved/sent` | passt weitgehend | wie Bestand; Freigabe über Recht `feed:approve` | **umgesetzt** — Entwurf/Freigabe, Sichtbarkeit, Pinning (`feed.integration.spec.ts`) |
| `feed_item_reads` | eigene Zeile; Admin/Autor sehen alle (`get_my_role()`, nicht org-gebunden) | org-übergreifend für Admins | org-gebunden | **umgesetzt** (`feed.integration.spec.ts`) |
| `poll_options`, `poll_votes` | Autor verwaltet Optionen; Stimme eigene, Option muss zur Org gehören; lesen Org-Mitglieder | passt | wie Bestand; doppelte Stimme per Constraint, nicht per vorherigem `count` | **umgesetzt** — eine Stimme je Mitglied, nur sichtbare Umfragen (`feed.integration.spec.ts`) |
| `wiki_docs` | lesen: öffentlich (`Published` + `public`) bzw. Org-Mitglieder nach `allowed_roles`/AG; **anlegen und ändern: jedes Org-Mitglied**; löschen admin/committee | Ändern ohne Rollenprüfung | lesen wie Bestand; schreiben Recht `wiki:edit` oder committee+ (D3); löschen committee+ | **umgesetzt** inkl. `allowed_roles` und AG-Bezug (`wiki.integration.spec.ts`) |
| `wiki_categories` | org-gebunden, admin/committee bzw. AG-Lead | vom Frontend nicht genutzt | wie Bestand, Nutzung klären | **umgesetzt** (`wiki.integration.spec.ts`) |
| `files` | 11 überlappende Policies; wirksam: **jedes Konto liest `member`-Dateien jeder Org und legt Dateien in jeder Org an** | belegt: B1, B3 | strikt org-gebunden; Sichtbarkeit `public/member/committee/admin/ag-only` auch beim Byte-Abruf; Uploader/Org-Admin ändern und löschen | **umgesetzt** — Sichtbarkeit am Byte-Abruf, signierte Links, Org-Grenze, Ordnerzyklen (`files.integration.spec.ts`) |
| `folders` | lesen Org-Mitglieder; anlegen/ändern admin/committee; löschen Org-Admin | passt | wie Bestand; Zyklen verhindern | **umgesetzt** (`files.integration.spec.ts`) |
| `knowledge_base` | lesen: global oder eigene Org, Datei muss sichtbar sein; schreiben nur Service | passt | Rechtefilter **vor** der Modellübergabe (§11) | **umgesetzt** — Rechtefilter in SQL **vor** dem Modellaufruf (`knowledge.integration.spec.ts`) |
| `chat_sessions`, `chat_messages` | Eigentümer des Chats | passt | Eigentümer und Organisation prüfen | **umgesetzt** — nur eigene Sitzungen, Werkzeuge mit Aufruferrechten (`chat.integration.spec.ts`) |
| `newsletter_config` | `ALL` für `app_role admin` **irgendeiner** Org; `smtp_pass` im Klartext | nicht org-gebunden; Secret in der DB | Org-Admin der eigenen Org; `smtp_pass` verschlüsselt, nie in Read-DTO | **umgesetzt** — nur Admin, Passwort verschlüsselt und nie ausgeliefert (`newsletter.integration.spec.ts`) |
| `onboarding_progress`, `user_tasks` | eigene Zeilen | passt | wie Bestand | **umgesetzt** — nur eigene Zeilen (`activity.integration.spec.ts`) |
| `audit_logs` | lesen: nur fest einkodierte UUID; schreiben Trigger | kein Org-Admin-Zugriff | schreiben im Service (E5); lesen Org-Admin eigene Org; Plattform-Admin D1 | **umgesetzt** — Admin der eigenen Organisation, Plattform-Admin alle (D1; `activity.integration.spec.ts`) |
| `analytics_events` | schreiben: **alle**; lesen: kaputte Policy + feste UUID | Org-Mitglieder können nie lesen | Erfassung über rate-limitierten Endpunkt; lesen Org-Admin eigene Org; D1 | **umgesetzt** — anonym schreiben, lesen Org-Admin/Plattform-Admin (`activity.integration.spec.ts`) |
| `feedback_submissions` | schreiben: anon/auth ohne Prüfung; lesen: feste UUID | – | Einreichen über rate-limitierten Endpunkt; lesen D1 | **umgesetzt** — anonym einreichen; lesen/ändern je Organisation mit Recht `view_issue_tracker`, Plattform-Admin alle (`activity.integration.spec.ts`) |
| `active_sessions` | lesen: **alle inkl. anonym**; eigene Zeile verwalten | belegt: A2; keine `organization_id` | Presence nur für Mitglieder derselben Org; Rollen/Pfad nie vom Client; Ablauf/Bereinigung | **umgesetzt** — jedes Mitglied meldet Anwesenheit (Name/Rollen serverseitig, nur der Pfad vom Client); die Liste „online“ sehen nur Admins der Organisation, Plattform-Admin alle (D7; `activity.integration.spec.ts`) |
| `storage.objects` (Bucket `files`) | jedes angemeldete Konto: lesen/anlegen/ändern/löschen | belegt: B2 | Zugriff nur über das Backend nach Metadatenprüfung (`files`-Tabelle) | **ersetzt** durch Backend-Zugriff mit Metadatenprüfung (E26, `files.integration.spec.ts`) |
| `storage.objects` (Bucket `avatars`) | lesen öffentlich; hochladen: **jeder**; ändern nur Eigentümer | anonymes Hochladen | Upload nur angemeldet, nur eigener Pfad; Lesen öffentlich | **entfällt** — Avatare und Logos sind URLs, die Oberfläche lädt nichts hoch; der Export inventarisiert den Bucket |

## 5. Betreiber-Entscheidungen D1–D8 (Stand 2026-10-14: nach sicheren Standards umgesetzt, Bestätigung offen)

Die Umsetzung steht in `02-entscheidungen-offene-fragen.md` E27; die Fragen bleiben bis zur Bestätigung durch den Betreiber offen.

| ID | Frage | Auswirkung |
|---|---|---|
| **D1** | **Fest einkodierter „Super Admin“** (UUID `2d8af6a7-…`): Soll es ein Plattform-Admin-Konzept geben (Flag am Konto, Rolle), oder entfällt der Zugriff auf `audit_logs`/`analytics_events`/`feedback_submissions` für die Plattform? | Lesezugriffe auf Audit, Analytics, Feedback |
| **D2** | **Status `Inactive`/`Pending`**: Im Bestand prüft keine Policy den Status. Sollen inaktive/ausstehende Mitglieder Zugriff behalten (jetzt so umgesetzt)? | Zugriff ausgeschiedener Mitglieder |
| **D3** | **`committee`**: Im Bestand gilt `has_permission(key)` (1-Parameter) und das Frontend: `committee` hat alle Schlüssel; `has_permission(key, org_id)` kennt `app_role` nicht. Jetzt umgesetzt: `committee` hat alle bekannten Schlüssel, ist aber kein Admin (E21). Passt das? | Rechte von `committee` |
| **D4** | **Öffentliche Lesbarkeit**: Welche Daten müssen anonym lesbar bleiben (öffentliche Org-Seite, öffentliche Events, Gast-Org-Einladungen, AG-Listen)? Im Bestand liest anonym fast alles. | öffentliche Endpunkte, Sitemap, Cache |
| **D5** | **Anonyme Schreibzugriffe** (Kontakte, Events, AGs): vermutlich Altlast aus der Entwicklung. Bestätigen, dass kein Feature darauf angewiesen ist. | Ablehnung anonymer Schreibzugriffe |
| **D6** | **Selbst-Registrierung von Organisationen**: darf jedes Konto beliebig viele Organisationen anlegen (Bestand: ja)? Quote? | Missbrauchsschutz |
| **D7** | **Presence**: Welche Daten sind sichtbar, wie lange (Bestand: alle sehen alle)? | Presence-Modell |
| **D8** | **Push-Tabellen**: Ist Web Push in Produktion aktiv (Tabellen fehlen im Dump)? | Push-Modul, Subscription-Import |

## 6. Rollenmodelle und Auflösung

Im Bestand gleichzeitig vorhanden:

1. **Legacy `members.app_role`** (`public|member|committee|admin`), von den Policies am häufigsten genutzt.
2. **Benutzerdefinierte `organization_roles`** (`is_system_admin`, `permissions[]`) über `members.role_id`.
3. **Mitgliedsbezogenes `members.permissions[]`** (Legacy-Array).
4. **Besitzer** `organizations.owner_id`.
5. **AG-Rollen** `ag_memberships.role` (`member|admin|lead`) und die separate Tabelle `working_group_members` (nicht zusammenführen, Auftrag §6/§7).
6. **Fest einkodierter Super Admin** (D1).

Widersprüche (belegt): `has_permission(key)` gibt `admin` und `committee` alle Rechte, `has_permission(key, org_id)` ignoriert `app_role` und kennt nur Rolle/System-Admin; `get_my_role()`/`has_permission(key)` sind nicht org-gebunden; das Frontend (`AuthService.hasPermission`) behandelt `committee` wie die 1-Parameter-Funktion.

**Umgesetzte Auflösung** (`backend/src/tenancy/permissions.ts`, Vorschlag E21, siehe D3):

- `isAdmin` = Besitzer **oder** System-Admin-Rolle **oder** `app_role = admin` (entspricht `is_admin_of_org OR is_owner_of_org`).
- `hasPermission(key)` = `isAdmin` **oder** `app_role = committee` **oder** `key ∈ Rollenrechte` **oder** `key ∈ Mitglieds-Legacy-Array`.
- Bekannte Schlüssel: `feed:create`, `feed:approve`, `wiki:edit`, `events:create`, `contacts:edit`, `view_issue_tracker`.
- Die Auflösung gilt immer **je Mitgliedschaft** (Konto + Organisation), nie kontoweit. Das Legacy-Modell wird nicht gelöscht, nur org-gebunden gelesen.

## 7. Umsetzungsstand (Phase 1 Rest)

| Baustein | Stand | Nachweis |
|---|---|---|
| Schema `organizations`/`organization_roles`/`members` (Migration 000005), Verbund-FK Rolle↔Org, eindeutige Mitgliedschaft je Konto und Org | umgesetzt | `tenancy.integration.spec.ts` („Datenhaltung“) gegen PostgreSQL |
| `GET /api/v1/me/memberships` (Ersatz für `get_user_memberships`) | umgesetzt | Tests anonymous, Einzel-/Mehrfachmitgliedschaft, leere Liste, gesperrtes Konto, eingeschleuste Query/Header |
| `OrgGuard` (Konto aus Token, Org aus Pfad, Mitgliedschaft aus DB; fremd und unbekannt identisch 403; ungültige UUID 400) | umgesetzt | Tests in `tenancy.integration.spec.ts`; Mutationen (Org-Filter in `find`/`listRoles` entfernt) werden erkannt |
| `GET /api/v1/orgs/:orgId/members/me` (Ersatz für `currentMember`), `GET /api/v1/orgs/:orgId/roles` | umgesetzt | wie oben |
| `RequirePermission`/`RequireAdmin` + `PermissionGuard`, Resolver | umgesetzt (Resolver getestet); noch kein fachlicher Endpunkt nutzt sie | `permissions.spec.ts` |
| Verknüpfung von Mitgliedern ohne Konto per **bestätigter** E-Mail (Ersatz für `handle_new_user_linking`) | umgesetzt (bei Bestätigung, Magic-Link-Einlösung, Login) | `member-linking.integration.spec.ts` (6 Tests), Mutation „bereits verknüpft übernehmen“ erkannt |
| Schreibende Mitglieder-/Rollen-Operationen (Anlegen, Rollenwechsel, Besitzerschutz, letzter Admin) | **umgesetzt** (`members.integration.spec.ts`) |
| Alle übrigen Tabellen der Matrix | **umgesetzt** (Zeilen in §4), je Modul mit Guard, Negativtests und Mutationsprüfung |
