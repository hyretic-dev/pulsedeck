# Arbeitsauftrag: PulseDeck vollständig von Supabase auf NestJS und PostgreSQL migrieren

Diesen Prompt im Root des PulseDeck-Repositories ausführen. Er ist ein Implementierungsauftrag, kein Auftrag, lediglich einen Plan oder ein Backend-Gerüst zu erstellen.

## 1. Ziel und verbindlicher Umfang

Ersetze Supabase in diesem Projekt vollständig durch ein von uns selbst gehostetes NestJS-Backend mit selbst gehosteter PostgreSQL-Datenbank. Das bestehende Angular-Frontend bleibt erhalten. Alle vorhandenen fachlichen Funktionen müssen anschließend über das neue Backend funktionieren.

Die Ablösung umfasst Datenzugriff, Authentifizierung, Autorisierung, Mandantentrennung, Storage, Realtime, Edge Functions, SQL-Funktionen und Trigger, Hintergrundaufgaben, Datenmigration, Frontend-Anbindung, Deployment, Betrieb, Tests und Dokumentation. Ein NestJS-Server, der intern weiterhin Supabase verwendet, erfüllt den Auftrag nicht. Ein ausschließlich neu aufgesetztes System ohne Migration bestehender Daten und Benutzer erfüllt ihn ebenfalls nicht.

Arbeite präzise und vollständig. Behaupte keine Fehlerfreiheit. Belege Korrektheit durch ausführbare Prüfungen und dokumentiere jede verbleibende Unsicherheit. Fehlende Zugänge oder nicht geprüfte Produktionskonfigurationen sind offene Voraussetzungen und kein Nachweis ihrer Abwesenheit.

Dieser Auftrag erlaubt die für die Ablösung notwendigen Änderungen am bisher eingefrorenen `src/app/shared/services/supabase.ts`, an seinen Konsumenten sowie an der Supabase-spezifischen Projektkonfiguration und den dazugehörigen Arbeitsregeln. Er erlaubt keinen unbeauftragten Umbau anderer Produkte oder Features. Produktive Umschaltung, Löschung des alten Systems und irreversible Datenoperationen erfolgen erst nach ausdrücklicher Freigabe eines konkret vorbereiteten und geprüften Ergebnisses.

## 2. Arbeitsregeln und Umsetzungstakt

Lies zuerst die geltenden `AGENTS.md`, `.agents/rules/`, relevante ältere Regeln in `.agent/rules/`, `README.md`, `DOCS.md`, `package.json`, `angular.json` und die vorhandenen Skills. Nutze Ponytail für die kleinste vollständige Umsetzung und die PostgreSQL-Hinweise für das Datenbankdesign. Diese Skills rechtfertigen keine ausgelassenen Funktionen oder Prüfungen.

Beachte die bestehenden Architektur-, Typ- und Sprachregeln. Antworte auf Deutsch. Feature-Grenzen, Repository-Ports, Signals und die vorhandene UI sollen erhalten bleiben. Eine allgemeine Angular-, PrimeNG-, Zoneless- oder Designmigration gehört nicht zu diesem Auftrag.

Der bestehende TDD-Ablauf aus `.agents/rules/general.md` bleibt bestehen: Bei einer Produktionsverhaltensänderung zuerst fachlich sinnvolle Tests schreiben; danach stoppen, bis der Nutzer deren Red-Ergebnis bestätigt. Erst dann minimale Implementierung und anschließendes Refactoring. Test- und Implementierungscode nicht im selben Antwortschritt generieren. Diese Stopp-Punkte sind Zwischenstände der Gesamtmigration, kein Abschluss des Auftrags. Ein durch einen fremden Bestandsfehler blockierter Test belegt nicht, dass die neue Anforderung fachlich geprüft wurde.

Kläre echte, nicht aus dem Repo ableitbare Betriebsentscheidungen früh und gebündelt. Arbeite währenddessen an unabhängigen Teilen weiter. Routinemäßige Implementierungsdetails verlangen keine wiederholte Freigabe. Konkrete Entscheidungen über Benutzerkontenmigration, Ausfallfenster und Infrastruktur mit unterschiedlichen betrieblichen Folgen müssen nachvollziehbar festgehalten werden.

Führe einen dauerhaften Fortschrittsnachweis im Repo. Unterteile die Migration in überprüfbare Schritte, aber lasse keinen offenen Schritt aus Zeitgründen oder wegen Kontextwechseln verschwinden. Keine TODOs, leeren Methoden, Fake-Erfolge, Mock-Produktionsadapter oder stillen Fallbacks auf Supabase im Endzustand. Mocks sind ausschließlich in Tests zulässig.

## 3. Bestandsaufnahme: Tatsächlichen Umfang ermitteln

Erstelle vor der Implementierung eine Abdeckungsmatrix mit diesen Spalten:

`Bestandsfunktion | Fundstellen/Konsumenten | Daten/SQL/Storage/Job | heutige Berechtigung | NestJS-Ersatz | Frontend-Ersatz | Migration | positive/negative Tests | Status/Nachweis`

Erfasse auch indirekte und dynamische Aufrufe, rohe `fetch`-Requests, generierte URLs, Realtime-Abonnements, Trigger-Nebenwirkungen und seltene Adminfunktionen. Gehe von Frontend-Routen und Benutzeraktionen bis zu den Daten und externen Effekten durch den vollständigen Ablauf. Eine Liste von Imports allein genügt nicht.

Prüfe den aktuellen Git-Status und respektiere vorhandene Änderungen. Die folgenden Hinweise stammen aus einer lokalen Bestandsaufnahme am 13.10.2026 und müssen gegen den dann aktuellen Stand geprüft und ergänzt werden.

### Frontend und zentrale Integrationsstellen

- Angular 21, TypeScript, PrimeNG, RxJS, Signals; Capacitor-Konfiguration für die mobile App; PWA/Service Worker und Web Push.
- `src/app/shared/services/supabase.ts`: SDK, Session/User/AuthReady-Signals, Auth, Tabellenzugriff, Storage, Realtime und Feedback.
- Alle Dateien in `src/app/shared/services/`, insbesondere Auth, Organisationen, Mitglieder, Rollen und Permissions, Kontakte, Arbeitsgruppen, Events, Registrierungen, Helferslots, Skills und Matching, Feed, Newsletter, Wiki, Dateien, Chatbot, Onboarding, Mikrotasks, Analytics, Statistik, Presence und Notifications.
- Direkte Supabase-Zugriffe gibt es auch in Komponenten, Guards und Layouts. Prüfe insbesondere Auth-Callback, Registrierung und Organisationserstellung, Organisationsauswahl und öffentliche Organisationsseiten, Kalender, Profil, Einstellungen, Audit/Logs, Issue-Tracker und Feedback.
- Prüfe beide Varianten der Organisationserstellung unter `features/organizations/` und ihre tatsächliche Verwendung. Keine Variante blind als entbehrlich einstufen.
- Öffentliche URLs und Routen: `/`, `/login`, `/auth/callback`, `/registrieren`, `/erstellen`, `/organisationen`, `/event/:id`, `/:slug` und `/:slug/dashboard/...`; außerdem tatsächliche Passwort-Recovery-Ziele und bestehende externe Links.

### Datenobjekte: Mindestinventar

Im Frontend oder in Edge Functions werden unter anderem diese Objekte angesprochen:

`organizations`, `organization_roles`, `members`, `contacts`, `working_groups`, `working_group_members`, `ag_memberships`, `events`, `event_registrations`, `event_slots`, `event_slot_signups`, `event_guest_organizations`, `skills`, `member_skills`, `wiki_docs`, `feed_items`, `feed_item_reads`, `poll_options`, `poll_votes`, `newsletter_config`, `files`, `folders`, `feedback_submissions`, `audit_logs`, `analytics_events`, `onboarding_progress`, `user_tasks`, `active_sessions`, `push_subscriptions`, `push_notification_queue`, `chat_sessions`, `chat_messages`, `knowledge_base` sowie Auth-Benutzer und Auth-Identitäten.

Das ist ein Suchstartpunkt, keine abschließend bestätigte Liste des produktiven Schemas. Erweitere sie um Views, Enums, Sequences, Constraints, Indizes, Grants, Policies, Trigger und Funktionen. Prüfe insbesondere die Unterschiede zwischen `working_group_members` und `ag_memberships`; nicht ohne fachlichen Nachweis zusammenführen.

Prüfe alle Dateien in `supabase/migrations/`, `supabase_schema.sql` und `schema_dump.sql`. Achtung: `schema_dump.sql` enthält im geprüften Stand eine Paketinstallationsaufforderung und ist kein verwendbarer SQL-Dump. Die übrigen Dateien dürfen ebenfalls nicht ungeprüft als vollständiges Live-Schema gelten. Mehrere vom Code genutzte Tabellen sind damit nicht automatisch vollständig rekonstruierbar.

Vergleiche bei vorhandenem Zugang mit einem echten Schemaexport und den tatsächlich installierten Migrationen. Erfasse zusätzlich produktive Auth-Einstellungen, OAuth-Provider, Mailvorlagen, Redirect-URLs, Storage-Buckets/Policies, Schedules, Webhooks, Secrets-Namen, Realtime-Konfiguration und Dashboard-only-Konfiguration. Zeige keine Secret-Werte oder personenbezogenen Exporte im Chat. Wenn diese Daten fehlen, führe die lokale Umsetzung weiter, kennzeichne aber die produktive Parität als noch nicht belegt.

### SQL-Funktionen, Trigger und Jobs

Erfasse mindestens die RPCs `get_user_memberships`, `get_members_by_skills` und `match_knowledge` sowie die tatsächlich verwendeten Helper und Triggerfunktionen, etwa `get_my_role`, `get_my_member_id`, `has_permission`, `is_ag_admin`, `is_admin_of_org`, `is_member_of_ag`, `has_slot_capacity`, Zählfunktionen, Audit-Trigger, Default-Skills/-Rollen, Owner-Schutz und Auth-User-Verknüpfung.

Suche nach `auth.uid()`, `auth.jwt()`, Referenzen auf `auth.users`, `storage.*`, `SECURITY DEFINER`, `cron.*`, `pg_net`, HTTP-Aufrufen aus SQL und Realtime-Publications. Ordne jedes Objekt einer dieser Varianten zu: unverändert portable SQL, angepasste PostgreSQL-Implementierung oder gleichwertige NestJS-Implementierung. Halte fest, wo eine Nebenwirkung künftig genau einmal entsteht.

### Edge Functions: Jede einzeln ersetzen

| Bestandsfunktion | Zu erhaltender Zweck und zu prüfende Semantik |
| --- | --- |
| `send-invitation` | Login-/E-Mail-Prüfung, Einladungen, Konto- und Mitgliedsverknüpfung |
| `invite-member` | Berechtigte Mitgliedereinladung, bestehende und neue Konten, erneute Einladung |
| `generate-magic-link` | Berechtigte Erstellung und Einlösung von Login-Links |
| `delete-auth-user` | Kontolöschung mit korrekten Folgen für alle Mitgliedschaften |
| `send-guest-invitation` | Gastorganisationen und deren Einladungsabläufe |
| `ical-export` | Öffentliche/private Kalender, AG-Filter, Download und Kalenderabonnement |
| `send-newsletter` | Testversand, Versandkonfiguration, Empfänger, Status und Fehler |
| `send-event-notification` | Terminbenachrichtigungen und bestehende Mail-/Queue-Semantik |
| `send-push` | Web Push, VAPID, Queue und Bereinigung ungültiger Subscriptions |
| `chatbot` | Auth, Chatverlauf, Streaming, Mistral, RAG und alle Tools |
| `ingest-docs` | Dokumenten-/Event-/AG-Indexierung und regelmäßige Aktualisierung |
| `ingest-file` | Dateiabruf, Extraktion, Chunking, Embeddings und Indexierungsstatus |
| `sitemap` | Öffentliche Sitemap und deren Konsumenten |

Die Tabelle ist keine Erlaubnis, die Implementierung aus dem Funktionsnamen abzuleiten. Lies jeweils den vollständigen Code und die Aufrufer. Konsolidiere überlappende Funktionen nur bei nachgewiesen identischem Verhalten.

### Build, URLs und Betriebsdateien

Prüfe `package.json`, Lockfiles, `scripts/set-env.js`, `scripts/generate-sitemap.js`, `src/environments/`, `Dockerfile`, `.dockerignore`, `nginx.conf`, `.github/workflows/docker-release.yml`, `src/robots.txt`, `ngsw-config.json`, `capacitor.config.ts`, Dokumentation und Hilfsskripte wie `test-ai.*` und `test-embed.ts`. Suche über das gesamte Repo, nicht nur unter `src/`.

`robots.txt` und weitere Dateien enthalten im Bestand direkte Supabase-Funktions-URLs. Erfasse außerdem gespeicherte Storage-URLs in Datenbankinhalten, Wiki-/Feed-Texten, Logos, Avataren, E-Mails und Kalenderabos. Solche Abhängigkeiten werden durch Entfernen des SDK nicht beseitigt.

## 4. Zielarchitektur festlegen

Baue ein eigenständiges NestJS-Backend, vorzugsweise unter `backend/`, ohne das Angular-Projekt neu zu generieren oder dessen Paketkonfiguration zu überschreiben. Nutze kompatible, unterstützte Node-, NestJS- und PostgreSQL-Versionen und halte sie reproduzierbar fest. Prüfe die verwendeten APIs anhand offizieller Dokumentation statt Versionswissen zu erraten.

Verwende fachliche Module mit klaren Zuständigkeiten. Auth, Organisationskontext und Autorisierung sind gemeinsame Infrastruktur; fachliche Module erhalten eigene Services und Datenzugriffsadapter. Keine Supabase-Query-Builder-Nachbildung und kein generischer Endpunkt, der beliebige Tabellen, Filter oder SQL aus dem Browser akzeptiert.

Stelle eine versionierte, dokumentierte HTTP-API bereit, beispielsweise `/api/v1`. Definiere Verträge für DTOs, Fehler, Paginierung, Filter, Sortierung, Counts, Nullable-Werte, Zeit-/Datumsfelder, Dateien und Events. Halte bestehende fachliche Modelle stabil; übersetze technische Unterschiede in Adaptern. OpenAPI und Verträge müssen mit der Implementierung überprüfbar übereinstimmen.

Wähle eine zum vorhandenen PostgreSQL-Schema passende Datenzugriffslösung. Berücksichtige bestehende UUIDs, SQL-Funktionen, RLS, Transaktionen, JSONB, Arrays und pgvector. Entscheide dich für eine konsistente Strategie und begründe sie. Kein automatisches Schema-Sync in Produktion, kein unkontrolliertes `db push`, keine ungeprüften ORM-generierten destruktiven Migrationen.

PostgreSQL bleibt serverseitig im privaten Netz. Trenne Migration-/Owner-Rolle und eingeschränkte Runtime-Rolle. Nutze parametrisierte Abfragen und einen begrenzten Connection Pool. Keine Browser-Datenbankzugänge, keine Superuser-Verbindung für normale Requests. Benötigte zusätzliche Dienste nur für konkret belegte Anforderungen einführen; keine Redis-, Kubernetes- oder Microservice-Pflicht ohne Bedarf.

## 5. Authentifizierung vollständig ersetzen

Implementiere die aktuell vorhandenen und nachweislich aktivierten Abläufe: Passwortlogin, Registrierung, E-Mail-Verifizierung, OTP/Magic Links, Einladungen, Passwortinitialisierung/-änderung/-reset, Logout, Session-Wiederherstellung und OAuth. Im zentralen Service sind Google, GitHub und Discord vorgesehen; prüfe, welche Provider tatsächlich angeboten und konfiguriert sind. Einen still deaktivierten Provider nicht als erfolgreiche Migration darstellen.

Entwirf eine belastbare Sessionstrategie für Browser, PWA und Capacitor. Lege Laufzeiten, Transport, sichere Speicherung, Verlängerung, Rotation, Widerruf, Geräte-/Mehrfachsessions und Logout-Verhalten fest. Nutze bewährte Bibliotheken und Kryptoprimitive, keine eigene Kryptografie. Bei JWTs Signatur, Algorithmus, Ablauf, Issuer und Audience prüfen; bei Cookies Secure, HttpOnly, SameSite und CSRF-Schutz passend zum Deployment prüfen. CORS-, Cookie- und WebSocket-Verhalten müssen auch auf dem tatsächlich verwendeten mobilen Origin funktionieren.

Einladungs-, Verifikations-, Recovery- und Magic-Link-Tokens sind zufällig, zweckgebunden, kurzlebig, serverseitig geschützt gespeichert und atomar nur einmal einlösbar. Teste parallele Einlösung, Ablauf, Widerruf und Wiederverwendung. Verhindere offene Redirects durch erlaubte Ziele. Entferne Tokens nach Einlösung aus Browser-URLs; verhindere ihre Ausgabe in Logs und Referer-abhängigen Abläufen.

Schütze Login, E-Mail-/Einladungsprüfung und Recovery vor Missbrauch. Übernimm keine mögliche Kontoenumeration als zwingende Parität. Erhalte den funktionalen Zugang zu bestehenden Konten mit angemessenen Antworten und Rate Limits.

### Bestehende Benutzer und Identitäten

Definiere vor dem Cutover eine tatsächlich ausführbare Importstrategie für Benutzer, Identitäten, verifizierte E-Mails, Passwort-Hashes soweit exportierbar, Sperrstatus und die Verknüpfungen über `members.user_id`, `organizations.owner_id`, Chatdaten und andere Referenzen.

Erhalte bestehende UUIDs, wo möglich. Bei notwendigem Mapping nutze ein vollständiges persistiertes Mapping mit referenzieller Prüfung. E-Mail allein darf nicht ohne geprüfte Identität zur Übernahme fremder Konten führen. Mehrere Organisationen eines Benutzers bleiben demselben Konto zugeordnet.

Prüfe den tatsächlichen Passwort-Hash-Algorithmus und die Verfügbarkeit der Exportdaten. Kompatible alte Hashes können nach erfolgreichem Login auf das gewählte neue Verfahren aktualisiert werden. Falls ein Import nicht möglich ist, beschreibe und implementiere einen abgestimmten Recovery-/Neueinladungsablauf; nicht still alle Konten löschen oder Passwörter ersetzen. Bestehende Supabase-Refresh-Tokens sind nicht automatisch neue NestJS-Sessions. Dokumentiere, ob und warum ein erneuter Login nötig wird.

Prüfe auch bereits verschickte Einladungs- und Resetlinks sowie OAuth-Provider-Identitäten. Plane deren Ablauf, Neuversand oder zeitlich begrenzte Übergangsstrategie. Solange ein nötiger Übergang von Supabase abhängt, ist die vollständige produktive Ablösung noch nicht abgeschlossen.

## 6. Autorisierung und Mandantentrennung

Ersetze die bisherige RLS-Wirkung durch mindestens gleichwertige serverseitige Durchsetzung. Frontend-Guards, versteckte Buttons und `organization_id` aus dem Request sind kein Berechtigungsnachweis.

Leite Benutzeridentität ausschließlich aus verifizierter Authentifizierung ab. Ein angeforderter Organisationskontext muss gegen die tatsächliche Mitgliedschaft oder explizit öffentliche Berechtigung geprüft werden. Beschränke auch einzelne Objekt-IDs, Joins, Counts, Suche, Exporte, Dateidownloads, Streams und Hintergrundaufgaben auf diesen Kontext.

Berücksichtige Organisationseigentümer, `app_role` mit `public/member/committee/admin`, benutzerdefinierte `organization_roles`, `permissions`, `is_system_admin`, Default-Rollen und AG-Rollen `member/admin/lead`. Legacy- und neue Rollenmodelle existieren gleichzeitig. Vergleiche SQL-Policies, `AuthService`, `PermissionsService`, Guards und UI-Regeln; dokumentiere Widersprüche und etabliere eine ausdrücklich geklärte Rechte-Matrix. Keine stillschweigende Privilegienausweitung, keine automatische Löschung des Legacy-Modells.

Verhindere das Setzen privilegierter Felder durch normale DTOs, etwa `owner_id`, `user_id`, `app_role`, `role_id`, `permissions`, `organization_id` und Freigabestatus. Rechteänderungen, letzte Admin-/Owner-Entfernung und Benutzerlöschung über mehrere Organisationen brauchen eigene Regeln und Tests.

Bei weiterverwendeter PostgreSQL-RLS: Ersetze Supabase-spezifische Auth-Helper, setze Request-Kontext transaktionslokal auf derselben Verbindung wie die Queries und teste fehlenden Kontext sowie Connection-Pool-Wiederverwendung. Kein Session-Kontext, der in den nächsten Request ausläuft. Runtime-Rollen dürfen Policies nicht versehentlich über Ownership oder `BYPASSRLS` umgehen. Prüfe `SECURITY DEFINER`, `search_path` und Execute-Rechte. Diese PostgreSQL-Eigenschaften sind in der [offiziellen RLS-Dokumentation](https://www.postgresql.org/docs/current/ddl-rowsecurity.html) beschrieben.

Wenn RLS durch API-seitige Policies ersetzt wird, belege dieselbe Isolation für jeden Zugangspfad und verhindere ungeschützte direkte Zugriffe. Erstelle Negativtests mit mindestens zwei Organisationen, Mehrfachmitgliedschaft, verschiedenen Rollen, fremden UUIDs und anonymous Zugriff. Presence-/Auditdaten dürfen nicht durch alte großzügige Policies organisationsübergreifend öffentlich werden.

## 7. Datenbank und fachliche Parität

Erstelle versionierte, überprüfbare Migrationen für ein leeres Zielsystem und eine separate Importstrecke für den Bestand. Bewahre IDs, Beziehungen, Slugs, Fachstatus, Rollen, Zeitstempel, Dateipfade und relevante historische Daten. Prüfe Reihenfolge, Defaults, Unique-/Check-Constraints, Fremdschlüssel, Delete-Verhalten, Sequenzen und benötigte Extensions.

Übernimm Supabase-Migrationen nicht blind in normales PostgreSQL. Ersetze Plattformobjekte und übersetze deren fachliche Wirkung. Übernimm Trigger oder verlagere die Wirkung in Transaktionen/Jobs; verhindere doppelte Auditlogs, Zähler, Default-Datensätze und Benachrichtigungen.

Erhalte alle bestehenden Benutzeraktionen, nicht nur CRUD. Dazu gehören insbesondere:

- Organisationserstellung mit Owner, Admin-Mitglied, Default-Rollen und Default-Skills als atomarer und bei Wiederholung sicherer Ablauf; Organisationswechsel und öffentliche Slug-Seiten.
- Mitgliederverwaltung einschließlich Import, Mehrfachlöschung, Einladung, Kontoverknüpfung, Kontakt-/Profilfeldern und Avataren.
- Arbeitsgruppen mit Leitung, Mitgliedschaften, Rechten und korrekten Zählern; Skill-Zuordnung und Smart Matching.
- Events einschließlich Serien, Sichtbarkeit, Registrierung/Absage, Helferslots, Kapazitäten, erforderlichen Skills und Gastorganisationen.
- Feed einschließlich Entwürfen, Freigabe, AG-Bezug, Newsletter-Queue/-Status, Umfragen, Stimmen, Pinning und Lesemarkierungen.
- Wiki, Kontakte, Dateien/Ordner, Feedback und Issue-Tracker, Onboarding, Tasks, Statistiken, Analytics, Audit und Presence.

Lege Transaktionsgrenzen für zusammengesetzte Änderungen fest. Kapazitätsprüfungen, Stimmen, Anmeldungen, Owner-Schutz und Token-Verbrauch müssen auch bei parallelen Requests korrekt sein. Ein vorheriges `count` mit anschließendem ungeschütztem Insert reicht dafür nicht. Verwende geeignete Constraints und Sperren; teste Konkurrenz gegen echtes PostgreSQL.

Erhalte Query-Semantik für Relations-Joins, Filter, Sortierung, Pagination, genaue Counts, Upserts, Nullable-Werte und Rückgabeformen, soweit die UI darauf angewiesen ist. Unterscheide Fehler, leere Listen und nicht vorhandene Objekte. Keine pauschale Umwandlung aller Fehler in `[]` oder Erfolg.

## 8. Storage und Dateien

NestJS und PostgreSQL allein ersetzen keinen Objektspeicher. Liefere eine konkrete selbst gehostete Storage-Lösung mit persistentem Speicher, Backup und geprüftem Betriebsmodell, etwa ein geschütztes Volume bei einem Einzelserver oder geeigneten selbst gehosteten Objektspeicher bei entsprechenden Anforderungen. PostgreSQL hält Metadaten; die Speicherung der Binärdaten muss ausdrücklich festgelegt werden.

Inventarisiere sämtliche Buckets und ihre reale Nutzung. Der Bucket `files` wird direkt verwendet; prüfe auch Logos, Avatare, eingebettete Medien und weitere Buckets. Migriere Binärdaten separat von Datenbankmetadaten. Erfasse Objektanzahl, Pfade, Größe, MIME-Typ und Inhaltschecksummen. Die [Supabase-Backup-Dokumentation](https://supabase.com/docs/guides/platform/migrating-within-supabase/backup-restore) behandelt Schema-/Datenexport und Storage-Transfer getrennt; daraus folgt keine automatische Portabilität zu unserem Zielsystem.

Erhalte Upload, Download, Vorschau, signed/public URLs, Ersetzen, Löschen, Pinning, Ordnerhierarchie, AG-Zuordnung und Indexierung. Durchsetze `public/member/committee/admin/ag-only` auch beim tatsächlichen Byte-Abruf. Öffentliche URL-Erzeugung darf private Dateien nicht öffentlich machen; signierte Links erhalten begrenzte Laufzeit und einen definierten Widerrufs-/Rechteänderungseffekt.

Prüfe Dateiname und MIME-Typ, Größenlimits, Pfad-/Key-Traversal, verschachtelte Ordner, Cross-Tenant-Objektzugriff sowie die Darstellung aktiver Inhalte. Nutze sichere Download-Header. Prüfe auch Reparatur/Cleanup nach fehlgeschlagenem Upload oder Metadateninsert, Löschung verwaister Objekte, Ordnerzyklen und fehlgeschlagene Extraktion. Die konkrete Upload-Integration muss zum gewählten HTTP-Adapter passen; siehe [NestJS File Upload](https://docs.nestjs.com/techniques/file-upload).

Ersetze oder mappe gespeicherte Supabase-Storage-URLs kontrolliert und idempotent. Prüfe alle Datei-/Metadatenbeziehungen und Backups. Ein DB-Dump ohne Binärdaten ist keine vollständige Datensicherung.

## 9. Realtime, Presence und Hintergrundaufgaben

Erfasse alle tatsächlichen Subscriptions, nicht nur die offensichtlichen in Kalender und Issue-Tracker. Liefere passende WebSocket-/SSE- oder andere nachweislich gleichwertige Mechanismen für die bestehende Benutzerwirkung.

Prüfe Auth beim Verbindungsaufbau und die Berechtigung für jeden Organisations-/Objektkanal. Reagiere auf Logout, Tokenablauf, Rollen- und Mitgliedschaftsänderung sowie Organisationswechsel. Teste Reconnect, verlorene Events mit Wiederabgleich, doppelte Events und vollständiges Unsubscribe/Cleanup. Publish erst nach erfolgreichem Commit, keine privaten Payloads an öffentliche Kanäle.

Presence bleibt von echten Auth-Sessions unterscheidbar. `active_sessions` enthält im Bestand unter anderem organisationsbezogene Rollen und den aktuellen Pfad. Übernimm diese Angaben nicht als vertrauenswürdige Berechtigung vom Client und lege Sichtbarkeit sowie Ablauf/Bereinigung fest.

Migriere sämtliche produktiven Cron-/Queue-Abläufe, darunter die in SQL vorgesehene tägliche Dokumentenindexierung. Bestimme wirkliche Zeitbasis und Zeitzone; eine SQL-Cron-Uhrzeit ist nicht automatisch Europe/Berlin. Wiederkehrende Benutzertermine und Kalender berücksichtigen Europe/Berlin inklusive Sommerzeitwechsel.

Jobs müssen Neustarts, parallele Instanzen, Fehler und Wiederholung beherrschen: persistenter Status, kontrollierte Retries, geeignete Locks/Leases, Deduplikation, Monitoring und ein geprüfter Wiederanlauf. Eine NestJS-Cron-Dekoration allein beweist diese Eigenschaften nicht. Prüfe die [NestJS Scheduling-Dokumentation](https://docs.nestjs.com/techniques/task-scheduling) und ergänze nur die für den Betrieb benötigten Mechanismen.

## 10. Mail, Push, Kalender und öffentliche Endpunkte

Erhalte SMTP-/Newsletter-Einstellungen und tatsächlich genutzte Mailprovider, inklusive Testmails und Einladungen. Secrets bleiben ausschließlich im Backend geschützt; liefere keine SMTP-Passwörter über normale Read-DTOs an das Frontend. Verhindere organisationsfremde Empfänger und doppelte Sendungen bei Jobwiederholung. Dokumentiere, wie unklare Providerantworten und teilweise erfolgreiche Sendungen behandelt werden.

Migriere Push-Subscriptions und, soweit verfügbar, die zugehörigen VAPID-Schlüssel sicher. Ohne passenden privaten Schlüssel kann die bestehende Subscription-Kompatibilität nicht behauptet werden. Falls ein Schlüsselwechsel nötig ist, implementiere den erforderlichen Neuabonnement-Ablauf. Teste Versand, opt-out, Browserunsupported und Bereinigung abgelaufener Endpunkte.

Erhalte iCal-Download und Kalenderabonnement mit öffentlicher und tokenbasierter Sichtbarkeit, Organisation/AG-Filter, stabilen Event-UIDs, Escaping, Content-Type und korrekten Zeiten. Kalender-Token sind Zugangsdaten; nicht in Logs ausgeben. Bestehende Abos auf einer fremden Supabase-Domain lassen sich nicht allein durch Änderung unserer Domain weiterleiten. Dokumentiere einen tatsächlichen Übergangs-/Neuabo-Ablauf und kennzeichne noch erforderliche Nutzeraktionen.

Ersetze Sitemap-Generator, Sitemap-Funktion und `robots.txt` gemeinsam. Öffentliche Organisations- und Eventdaten müssen erreichbar bleiben, private Daten werden explizit ausgeschlossen. Prüfe Caching, robots-Verweise, Umgebungsdomains und Reverse-Proxy-Routing.

## 11. Chatbot und RAG vollständig migrieren

Portiere die Mistral-/AI-SDK-Integration, alle bestehenden Tools, Chat-Sessions/-Nachrichten, Dokumenten- und Dateiinhalte, Embeddings, Suchfunktion und Indexierungsjobs. Behalte die derzeitige fachliche Funktion; ein Wechsel des LLM-Providers gehört nicht zum Auftrag.

Die vorhandene Migration beschreibt `vector(1024)` und einen HNSW-Index. Prüfe dies gegen tatsächliche Daten und das genutzte Embedding-Modell. Installiere passende pgvector-Unterstützung im Zielsystem. Übernimm Embeddings verlustfrei oder liefere einen begründeten, geprüften Neuindexierungsablauf. Dokumentiere Versions-/Dimensionskompatibilität und Indexwiederaufbau.

Berücksichtige globale Dokumente mit `organization_id IS NULL`, organisationsbezogene Quellen und die engere Sichtbarkeit von Dateien/AGs. Zugehörigkeit zur Organisation allein darf keinen Zugriff auf vertrauliche Dateiinhalte über RAG eröffnen. Rechtefilter müssen vor der Übergabe an das Modell und vor der Ausgabe greifen.

Chat-Sessions und Nachrichten werden serverseitig auf Eigentümer und Organisation geprüft. Jeder schreibende Tool-Aufruf verwendet dieselben validierten fachlichen Operationen und Rechte wie die reguläre API. Vom Client übergebene `system`-/`tool`-Nachrichten, fremde Session-IDs oder Instruktionen aus Dokumenten dürfen keine Berechtigung erteilen.

Der bestehende Frontend-Client verarbeitet ein AI-SDK-Datenstreamformat und `x-chat-session-id`. Bewahre diesen Vertrag oder migriere beide Enden gemeinsam. Teste beliebig geschnittene Netzwerkchunks, UTF-8, mehrere Frames pro Chunk, unterbrochene Streams, Modellfehler und Abbruch. Reverse Proxy darf Streams nicht unbeabsichtigt puffern. Stelle sicher, dass Datenpersistenz nach Abbruch und Tools mit Seiteneffekten ein definiertes Verhalten haben.

Indexierung muss fehlertolerant und wiederholbar sein. Lösche keinen vollständigen funktionierenden Index, bevor Ersatz bereitsteht. Rechteänderung, Dateilöschung und AG-/Eventänderung müssen den Index konsistent aktualisieren.

## 12. Angular-Anbindung und Konfiguration

Ersetze alle Supabase-Zugriffspfade durch typisierte HTTP-/Realtime-/Auth-Adapter. Erhalte vorhandene Repository-Ports und führe fehlende Abstraktionen dort ein, wo die Ablösung sie tatsächlich benötigt. Keine Domain- oder UI-Abhängigkeit von Supabase-Typen im Endzustand. Beachte den Unterschied zwischen dem reinen Domain-Interface und Angular-DI-Tokens; kopiere widersprüchliche Architekturbeispiele nicht blind.

Erhalte oder migriere bewusst die Verträge von `AuthService`, Membership-Auswahl, `currentMember`, `currentOrgId`, AuthReady, Guards und Organisationsrouting. Prüfe Race Conditions beim Start und Organisationswechsel sowie Cache-/Signal-Leaks zwischen Benutzern und Organisationen. Keine Annahme, dass ein Client-Org-Signal serverseitige Rechte garantiert.

Implementiere zentrale API-Konfiguration, passenden Angular-HTTP-Provider, Auth-Transport, konsistente Fehlerbehandlung und Session-Erneuerung. Verhindere konkurrierende Refresh-Schleifen. Formulare, Uploads und Chatstream müssen weiterhin die erwarteten Lade-, Erfolg- und Fehlerzustände zeigen.

Passe `environment.example.ts`, Generator, Docker-Build, CI-Konfiguration und Produktionskonfiguration an. Öffentliche API-/Realtime-/Web-Push-Konfiguration ist von DB-, SMTP-, JWT-, OAuth- und Mistral-Secrets getrennt. Keine Secrets in Frontendbundles, Build-Args, Images oder Logs. Prüfe auch `.dockerignore`, damit Backend-/Migrationsartefakte im richtigen Build-Kontext landen.

Prüfe Angular-Routes, PWA-Caches und bereits installierte Clients: Ein altes gecachtes Bundle kann nach Cutover weiter Supabase aufrufen. Liefere einen tatsächlichen Aktualisierungs-/Kompatibilitätsplan und teste ihn, einschließlich mobiler Builds und Deep Links.

Aktualisiere die technische Dokumentation und den Backend-Provider-Verweis in `src/app/features/legal/datenschutz.component.ts` entsprechend dem tatsächlich gewählten Hosting und den weiter genutzten externen Diensten. Erfinde keine Betreiber-, Vertrags- oder Datenschutzangaben; fehlende Betreiberinformationen müssen vor Veröffentlichung ergänzt werden.

## 13. Self-Hosting und Betrieb

Liefere ein reproduzierbares lokales und produktionsgeeignetes Setup, beispielsweise Docker Compose für Angular/Nginx, NestJS und PostgreSQL plus den begründet gewählten Dateispeicher. Berücksichtige das bestehende Docker-/Nginx-Setup und den Coolify-Healthcheck-Hinweis; erfinde keine bestätigte Hostingumgebung, wenn nur Hinweise vorliegen.

Nötig sind persistente Volumes, interne Netze, korrektes Proxy-Routing vor dem SPA-Fallback, TLS-Anbindung, konfigurierte Origins, Uploadlimits, Streaming-/WebSocket-Unterstützung, Health/Liveness/Readiness, Startreihenfolge, Migration-before-serve, Graceful Shutdown und überprüfte Neustartfähigkeit. PostgreSQL wird nicht als öffentlicher Anwendungsport bereitgestellt.

Konfiguration wird beim Start validiert; fehlende Pflichtwerte führen zu verständlichen Fehlern. Nutze getrennte Entwicklungs-, Test-, Staging- und Produktionsdaten. Migrationen laufen kontrolliert und nicht gleichzeitig unkoordiniert in jeder Replica.

Liefere sichere Sicherung und Wiederherstellung für Datenbank, Binärdateien und nötige Konfiguration. Prüfe mindestens einen vollständigen Restore auf einem separaten System. Lege Aufbewahrung sowie realistische RPO/RTO gemeinsam mit dem Betreiber fest; keine erfundenen Zusagen. Falls Point-in-Time-Recovery erforderlich ist, berücksichtige WAL und dazu passende Restore-Prüfungen.

Liefere strukturierte Logs mit Request-IDs und Secret-/PII-Redaktion sowie Beobachtbarkeit für HTTP-Fehler, DB-Pool, Jobfehler, Mail/Push und Storage. Definiere die tatsächlich benötigten Alarmbedingungen und zuständigen Betriebsaktionen. Dokumentiere Installieren, Updaten, Migrieren, Backup, Restore und Incident-/Rollback-Abläufe mit funktionierenden Befehlen.

## 14. Datenmigration und produktive Umschaltung

Die Migration muss wiederholbar, kontrollierbar und anhand eines Manifests prüfbar sein. Implementiere Export/Import und Validierung als echte Werkzeuge mit Dry-run, Checkpoints, klaren Fehlercodes und einer sicheren Wiederaufnahme. Quell-/Zielverbindungen sind explizit und Geheimnisse werden nicht protokolliert. Ein fehlgeschlagener Import darf keine erfolgreiche Teilmigration als Gesamt-Erfolg melden.

Prüfe vorab PostgreSQL-Versionen, Exportrechte, Extensions, Datenvolumen und Storage-Zugriff. Unterscheide portable Anwendungsdaten von Supabase-internen Plattformdaten. Ein Supabase-Backup-Restore auf einer anderen Supabase-Instanz ist keine Anleitung für einen unveränderten Restore auf plain PostgreSQL.

Führe einen vollständigen Probelauf auf isoliertem Staging aus. Vergleiche nicht nur Zeilenzahlen: Prüfe IDs/Beziehungen, kanonisch gebildete Inhaltsprüfsummen, FK-/Unique-Konsistenz, Rollen/Mitgliedschaften, Counts pro Organisation, Zeitstempel, Sequenzen, Auth-Verknüpfungen, Storage-Inhalte und vorhandene Vektoren. Dokumentiere jede beabsichtigte Transformation und jede Differenz.

Erarbeite einen konkreten Cutover-Plan. Wähle ein abgestimmtes Wartungsfenster mit vollständigem Schreibstopp inklusive Jobs oder eine getestete Delta-/Replikationsstrategie. Ein frühes Backup ohne Erfassung späterer Writes reicht nicht. Verhindere auch Änderungen durch alte Frontends, APIs, Uploads, Trigger und Hintergrundjobs während des finalen Transfers.

Der Plan enthält mindestens:

1. Vorbedingungen, Freigaben, verantwortliche Schritte und überprüfbaren Backup-/Restore-Stand.
2. Stoppen oder kontrolliertes Auslaufen alter Writes, Jobs und Benachrichtigungen.
3. Abschließenden konsistenten DB-/Storage-/Auth-Transfer und Differenzprüfung.
4. Konfigurations-/Frontend-/Proxy-Umschaltung, Session- und Client-Update-Strategie.
5. Smoke Tests für alle kritischen Benutzerrollen und öffentliche Seiten.
6. Überwachung, Abbruchkriterien, Rollback-Frist und Umgang mit neuen Writes.
7. Erst nach erfolgreicher Abnahme: Stilllegung alter Dienste und Widerruf alter Schlüssel.

Ein Zurückschalten auf den alten Server ist nach neuen Zielsystem-Writes kein vollständiger Rollback. Beschreibe und probe, wie diese Daten erhalten, zurückgeführt oder während einer zunächst schreibgesperrten Abnahme vermieden werden. Dasselbe gilt für neue Benutzer, Passwortänderungen, Dateiuploads und bereits verschickte Nachrichten. Lösche Supabase erst, wenn keine aktiven technischen oder zwingenden Übergangsabhängigkeiten mehr bestehen und dies freigegeben wurde.

## 15. Tests und verbindliche Abnahmekriterien

Erfasse zuerst den bestehenden Build-/Testzustand. In einer vorherigen lokalen Prüfung scheiterte `npm test -- --watch=false` am Import des nicht exportierten `Supabase` in `src/app/shared/services/supabase.spec.ts`; `npm run build` scheiterte am Netzwerkabruf von Google Fonts. Prüfe den aktuellen Stand erneut und trenne Bestandsfehler, Umgebungsprobleme und neue Regressionen.

Die Regeln nennen Jest, während `package.json`, `angular.json` und `tsconfig.spec.json` im geprüften Stand Vitest/Angular Unit Test verwenden. Kläre diese Diskrepanz vor dem Festlegen des Testworkflows. Keine ungefragte Testframeworkmigration und keine unprüfbaren Testbehauptungen. Für NestJS wird ein tatsächlich eingerichteter und ausführbarer Runner benötigt.

Pflichtnachweise:

- Frontend- und Backend-Typecheck/Build; Unit-/Contract-Tests; API-Integrationstests gegen echtes PostgreSQL; Migrations- und Restore-Tests; vollständige E2E-Benutzerabläufe.
- Jede Zeile der Abdeckungsmatrix hat eine implementierte Lösung und passende Nachweise. Keine unbestätigten Punkte als grün markieren.
- Alle Auth-Flows inklusive fehlerhafter/abgelaufener Tokens, Mehrfachorg, Refresh/Logout und notwendiger Kontenmigration sind geprüft.
- Rechte-/Mandanten-Negativtests umfassen Listen, Einzelobjekte, verschachtelte Beziehungen, Änderungen, Exporte, Dateien, Realtime, Presence und RAG/Tools.
- Gleichzeitige Registrierungen/Slots, Votes, Tokenverbrauch und Jobs verursachen keine Überbuchung, doppelte Wirkung oder Dateninkonsistenz.
- Datei-/Ordnerabläufe, Mail/Push, iCal/Zeitzonen, Sitemap, Chatstream und Indexierung funktionieren einschließlich ihrer Fehlerpfade.
- Migration auf leerer DB, repräsentativer Bestandsimport, Wiederaufnahme nach Fehler, vollständiger Restore und Cutover-/Rollback-Probe sind erfolgreich.
- Repräsentative Lasttests mit vereinbartem Datenvolumen und echten Query-Plänen prüfen Latenz, Indizes, Poolgrenzen, Speicher und lange Upload-/Stream-Requests. Kein erfundener Skalierungsnachweis.
- Das System startet nach Containerneustart mit erhaltenen Daten und läuft ohne Supabase-Verbindung. Teste das ausdrücklich durch gesperrten Supabase-Zugang.
- Abschluss-Suche zeigt keine aktive Supabase-Nutzung in App, Backend, Jobs, Deployment, CI oder produktiven URLs; das SDK und nicht mehr nötige CLI-Abhängigkeiten sind aus Paketen und Lockfiles entfernt.

Historische SQL-Dateien, dieses Migrationsdokument oder der PostgreSQL-Best-Practice-Skill dürfen Supabase weiterhin als historische Quelle erwähnen. Klassifiziere solche Treffer, statt durch blindes Löschen die Nachvollziehbarkeit zu zerstören. Aktive Arbeitsregeln und Dokumentation müssen den NestJS-Zielzustand beschreiben.

Tests mit Datenbank-Mocks allein gelten nicht als Beleg für RLS, SQL, Constraints, Transaktionen, Sperren oder Migrationen. Externe Mail-/Push-/LLM-Dienste dürfen für deterministische Tests kontrolliert simuliert werden; ergänze nachvollziehbare Staging-Smoke-Tests für die reale Integration. Nicht ausgeführte externe Prüfungen bleiben ausdrücklich offen.

Der Auftrag ist erst vollständig abgeschlossen, wenn Implementierung, Betriebssetup, Daten-/Benutzer-/Dateimigration und alle vereinbarten Abnahmekriterien nachweislich erfüllt sind. Eine ausstehende Produktionsfreigabe ist als „bereit zur Umschaltung“ zu melden, nicht als bereits erfolgte produktive Ablösung.

## 16. Erwartete Artefakte und erste Antwort

Liefere im Repo:

1. Vollständige Bestands-/Abdeckungsmatrix und dokumentierte Architektur-/Betriebsentscheidungen.
2. Ausführbares NestJS-Backend, PostgreSQL-Migrationen und vollständige Angular-Adapter.
3. Ausführbare Daten-/Auth-/Storage-Migrations- und Validierungswerkzeuge.
4. Reproduzierbares Hosting-/CI-Setup mit Konfigurationsbeispielen ohne Secrets.
5. Aussagekräftige Tests und ein Bericht mit Befehlen, Ergebnissen und offenen Prüfungen.
6. Betriebsanleitung, Backup-/Restore-Nachweise, Cutover-/Rollback-Runbook und angepasste Repo-Regeln.
7. Einen abschließenden Paritätsbericht, der jede alte Funktion ihrem implementierten und geprüften Ersatz zuordnet.

Beginne jetzt mit Repo-Analyse und Abdeckungsmatrix. Berichte zuerst konkrete Funde, Bestandsfehler und nur die entscheidenden offenen Voraussetzungen. Lege eine nachvollziehbare Umsetzungsreihenfolge vor, die Auth und Autorisierung vor ungeschützten fachlichen Endpunkten absichert. Bereite dann den ersten fachlich aussagekräftigen Red-Schritt gemäß Repo-TDD vor. Bleibe bis zum vollständig belegten Ergebnis an diesem Auftrag; stoppe nur an den tatsächlichen TDD-, Informations- oder Produktionsfreigabegrenzen.

Prüfe technische Details anhand offizieller Quellen. Für das NestJS-Auth-/DTO-Grundgerüst sind die [Authentifizierungsdokumentation](https://docs.nestjs.com/security/authentication) und [Validierungsdokumentation](https://docs.nestjs.com/techniques/validation) Einstiegspunkte; sie ersetzen keine Prüfung unserer projektspezifischen Benutzer- und Rechteabläufe.
