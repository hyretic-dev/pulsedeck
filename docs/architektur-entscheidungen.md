# Architektur- und Betriebsentscheidungen

Gültiger Stand der Entscheidungen, auf die Code und Konfiguration verweisen (IDs `E…`, `O…`, `D…`). Die IDs stammen aus der
Umstellung auf das eigene Backend (Oktober 2026); Begründungen, Prüfprotokolle und der frühere Bestand stehen in der Git-Historie
(Commit `ab6ac6d`, Verzeichnis `docs/migration/`). Lücken in der Nummerierung sind Entscheidungen, die nur die einmalige
Datenübernahme betrafen.

## Entscheidungen

| # | Entscheidung |
|---|---|
| E1 | NestJS-Backend unter `backend/` mit eigener `package.json`, unabhängig vom Angular-Build. |
| E2 | Datenzugriff mit `node-postgres` und handgeschriebenen, parametrisierten Queries; Schema über versionierte SQL-Migrationen (node-pg-migrate). Kein ORM. |
| E3 | API unter `/api/v1`, OpenAPI über `@nestjs/swagger`, DTOs mit `class-validator` (unbekannte Felder werden abgewiesen). |
| E4 | Autorisierung ausschließlich im Backend (Guards/Services), keine Row Level Security. Die Runtime-Rolle der Datenbank hat keine Owner- oder DDL-Rechte; Migrationen laufen mit einer eigenen Rolle. |
| E5 | Nebenwirkungen (Audit, Zähler, Standardrollen/-skills, Besitzerschutz, `updated_at`, Mail-/Push-Aufträge) entstehen in der Transaktion des Moduls — genau einmal oder gar nicht. Keine Trigger. |
| E6 | Echtzeit über SSE statt WebSockets (konkretisiert in E28). |
| E7 | Chatbot: Datenstrom im AI-SDK-Format und Header `x-chat-session-id`. |
| E8 | Zeitgesteuerte Arbeit im Backend-Scheduler, Zeitzone Europe/Berlin (konkretisiert in E29). |
| E9 | Betrieb per Docker Compose: nginx-Frontend, Backend, PostgreSQL 17 mit pgvector, Datei-Volume. PostgreSQL ohne öffentlichen Port; das Backend migriert vor dem Start (schlägt das fehl, startet es nicht). |
| E10 | JWT mit `jose`. |
| E11 | Tests und Implementierung in einem Zug; Nachweis durch tatsächlich ausgeführte Läufe. |
| E12 | Passwörter mindestens 8 Zeichen und höchstens 72 Bytes (Grenze von bcrypt), serverseitig erzwungen. |
| E13 | OpenAPI (`/api/docs`, `/api/docs-json`) nur intern; nginx antwortet von außen mit 404 (siehe E20). |
| E14 | Rate-Limits je E-Mail und IP: Login 5 / 15 min, Mail-Endpunkte (Registrierung, Magic-Link, Reset) 3 / h; konfigurierbar über `RATE_LIMIT_*`. |
| E15 | Datenbank-Pool `PG_POOL_MAX` (Standard 10), Idle-Timeout 30 s, Verbindungs-Timeout 5 s, Schließen beim Shutdown. |
| E16 | Mail-Transport `log` nur in der Entwicklung; mit `NODE_ENV=production` lehnt die Startprüfung ihn ab. |
| E17 | Wartungsendpunkt `POST /api/v1/maintenance/purge-expired-tokens` mit Header `X-Maintenance-Token` (`MAINTENANCE_TOKEN`, leer = 404), timing-sicherer Vergleich. |
| E18 | Fehlervertrag `{ code, message }` mit stabilen Maschinencodes für alle HTTP-Fehler. |
| E19 | Passwort-Login nur mit bestätigter E-Mail (sonst `403 email_not_verified`, unbekannt/falsch bleibt 401). Das Einlösen eines Magic- oder Reset-Links bestätigt die E-Mail. |
| E20 | Zugangsdaten nie in Logs: nginx blockt `/api/docs*` unabhängig von Groß-/Kleinschreibung, das Backend routet case-sensitive, das Access-Log enthält weder Query-String noch Referer. |
| E21 | Rechteauflösung je Mitgliedschaft (siehe „Rechte“). |
| E22 | Verknüpfungs-Token (`connection_token`) verlassen das Backend nie. Feldnamen siehe E32. |
| E23 | Mandantenkern: Rolle muss zur Organisation gehören (Verbund-FK), höchstens eine Mitgliedschaft je Konto und Organisation, `members.email` als `citext`; Mitglieder ohne Konto werden nur über eine **bestätigte** E-Mail verknüpft. |
| E24 | Mails werden asynchron über die Outbox zugestellt; Fehler werden ohne Link, Token und Empfänger geloggt. Links tragen ihren Zweck (`/auth/callback?type=verify\|magic\|reset&token=…`) und gelten 24 Stunden. Mailtexte in „du“-Form. |
| E25 | Schutz vor Kontoenumeration über die Antwortzeit: Platzhalter-Hash bei unbekannter E-Mail, Hash vor dem Nachschlagen, Mindestantwortzeit `AUTH_MIN_RESPONSE_MS` (200 ms); E-Mails werden getrimmt und kleingeschrieben. |
| E26 | Dateien im Docker-Volume `files-data`, Schlüssel `<orgId>/<fileId>`; Port `ObjectStorage` bleibt austauschbar (S3 möglich). Byte-Abruf nur nach Sichtbarkeitsprüfung, signierte Download-Links 5 Minuten, `public`-Dateien ohne Anmeldung, `nosniff` und Sandbox-CSP, Upload-Grenze `MAX_UPLOAD_MB` (25). |
| E27 | Rechte-Entscheidungen D1–D8 (siehe „Rechte“). |
| E28 | Echtzeit `GET /orgs/:orgId/realtime?tables=…`: Impulse ohne Nutzdaten über `pg_notify` in derselben Transaktion, Mitgliedschaft alle 60 s neu geprüft, `resync` nach Reconnect, höchstens 5 Verbindungen je Nutzer. Der Client lädt über die normale API nach. |
| E29 | Hintergrundarbeit im Backend-Prozess, beansprucht über `scheduler_state` (jede Aufgabe läuft bei mehreren Instanzen genau einmal): Ticks alle 15 s für Mail-Outbox, Push und Indexaufträge, Newsletter nach `APP_TIMEZONE`, täglich Wissens-Stammdaten, stündlich Wartung. SMTP je Organisation mit verschlüsseltem Passwort (`SECRETS_ENCRYPTION_KEY`, AES-256-GCM) und SSRF-Schutz (`SMTP_ALLOW_PRIVATE_HOSTS`). Abschalten mit `JOBS_ENABLED=false`. |
| E30 | KI/RAG über Mistral (`mistral-embed` mit 1024 Dimensionen, `mistral-small-latest`); Rechtefilter in SQL vor dem Modellaufruf, Werkzeuge mit den Rechten des Aufrufers. Ohne `MISTRAL_API_KEY` antworten die KI-Endpunkte 503. |
| E31 | Frontend-Sitzung im `localStorage` (`pulsedeck.session`), ein Refresh über alle Tabs (Web Lock), bei 401 genau eine Erneuerung, Tokens werden nach dem Einlösen aus der URL entfernt. |
| E32 | Fachmodule liefern die Felder in snake_case wie die Angular-Modelle; berechnete Werte (`isAdmin`, `permissions`, `isPlatformAdmin`) in camelCase. Das Frontend beschränkt Nutzdaten vor dem Senden per `pick(…)`. |
| E35 | `READ_ONLY=true` am Frontend-Container: schreibende API-Aufrufe → 503 `read_only`; Login, Refresh, Logout und `check-email` bleiben möglich. |
| E36 | Native Apps: API-Adresse über `npm run build:mobile` (`PULSEDECK_API_URL`); das Backend erlaubt nur die in `CORS_ORIGINS` genannten Ursprünge (exakt, ohne Credentials). |
| E39 | Produktivbetrieb auf Coolify mit `docker-compose.coolify.yml` (eine Datei, keine Host-Ports, keine eigenen Netze, keine Bind-Mounts). Anleitung: `docs/betrieb/coolify.md`. |
| O2 | Sitzungen nur per Bearer-JWT: kurzlebiges Access-Token, serverseitig rotierbares und widerrufbares Refresh-Token. Keine Cookies, kein CSRF-Transport. |
| O4 | Mail über `MAIL_TRANSPORT=smtp` oder `resend`; produktiv IONOS-SMTP (`mailer@pulsedeck.de`). |
| O10 | Nur das Backend hat ausgehenden Netzzugang (Netz `egress`); PostgreSQL bleibt im internen Netz. |

## Rechte

**Auflösung je Mitgliedschaft (E21, `backend/src/tenancy/permissions.ts`)** — immer an Konto **und** Organisation gebunden:

- `isAdmin` = Besitzer der Organisation **oder** Rolle mit `is_system_admin` **oder** `app_role = admin`.
- `hasPermission(key)` = `isAdmin` **oder** `app_role = committee` **oder** `key` in den Rechten der Rolle **oder** im Rechte-Array des Mitglieds.
- Schlüssel: `feed:create`, `feed:approve`, `wiki:edit`, `events:create`, `contacts:edit`, `view_issue_tracker`.
- Unsichtbar → 404, sichtbar aber nicht erlaubt → 403; fremde und unbekannte Organisation sind nicht unterscheidbar (403).

**D1–D8 (E27):**

| ID | Regel |
|---|---|
| D1 | Plattform-Administrator über `auth_users.is_platform_admin`; `/platform/*` hinter `PlatformAdminGuard`. Es gibt genau ein solches Konto. |
| D2 | Status `Inactive`/`Pending` entzieht keinen Zugriff. |
| D3 | `committee` hat alle Rechte-Schlüssel, ist aber kein Admin. |
| D4 | Anonym lesbar sind nur: öffentliche Organisationsseite, als öffentlich markierte Termine, `public`-Dateien, iCal (Token oder öffentlicher Feed), Sitemap und `robots.txt`. |
| D5 | Schreiben braucht Anmeldung und Mitgliedschaft; anonym nur Analytics-Ereignisse und Feedback (rate-limitiert). |
| D6 | Jedes bestätigte Konto darf Organisationen anlegen, ohne Quote. |
| D7 | Präsenz: Name und Rollen kommen serverseitig aus der Mitgliedschaft, vom Client nur der Pfad; die Liste „online“ (5 Minuten) sehen Admins der Organisation, der Plattform-Admin alle. |
| D8 | Web-Push mit VAPID aus der Umgebung; Empfänger nach Sichtbarkeit des Termins/Beitrags, Endpunkt-Allowlist. |

**Regeln je Bereich** (jede Zeile mit Negativtests gegen echtes PostgreSQL in `*.integration.spec.ts`):

| Bereich | Lesen | Schreiben |
|---|---|---|
| Organisation | öffentlich nur das Seiten-DTO (Name, Slug, Logo, Beschreibung, Farbe, Branding), sonst Mitglieder | Anlegen mit dem Aufrufer als Besitzer (atomar mit Standardrollen/-skills); Einstellungen Admin |
| Rollen | Mitglieder | Admin |
| Mitglieder | Mitglieder | eigene Zeile nur Profilfelder; `app_role`, `role_id`, `permissions`, `status`, Verknüpfung nur Admin; Schutz von Besitzer und letztem Admin |
| Skills | Mitglieder | Admin bzw. eigene Skills |
| Arbeitsgruppen (`working_groups`, `working_group_members`, `ag_memberships`) | Mitglieder | Admin oder AG-Leitung; Selbst-Beitritt nur in AGs der eigenen Organisation |
| Termine, Anmeldungen, Helferslots, Gast-Organisationen | öffentlich nur mit `public` in `allowed_roles`, sonst Mitglieder mit passender Rolle/AG | `events:create`; Anmeldung nur eigene; Slot-Kapazität atomar |
| Feed, Umfragen, Gelesen-Status | nach Freigabe und Sichtbarkeit | `feed:create`, Freigabe `feed:approve`; eine Stimme je Mitglied |
| Wiki | öffentlich (`Published` + `public`) bzw. nach `allowed_roles`/AG | `wiki:edit`; löschen committee oder Admin |
| Kontakte | Mitglieder (globale Kontakte: alle Mitglieder) | `contacts:edit`; globale nur Plattform-Admin |
| Dateien, Ordner | Sichtbarkeit `public/member/committee/admin/ag-only`, auch beim Byte-Abruf | Hochladende Person oder Admin; Ordnerzyklen verhindert |
| Wissensbasis, Chat | Rechtefilter vor dem Modellaufruf; nur eigene Chat-Sitzungen | nur das Backend |
| Newsletter | Admin; SMTP-Passwort nie ausgeliefert | Admin |
| Onboarding, Aufgaben | eigene | eigene |
| Audit, Analytics | Admin der eigenen Organisation, Plattform-Admin alle | nur das Backend (Analytics auch anonym) |
| Feedback | `view_issue_tracker` je Organisation, Plattform-Admin alle | anonym einreichen |

## Offen

| # | Punkt |
|---|---|
| O12 | Hosting-Angaben (Dienstleister, Standort, Auftragsverarbeitung) in der Datenschutzerklärung. |
| O14 | Native Apps auf einem echten Gerät prüfen (Ursprung, CORS, SSE im WebView). |
| O15 | Abhängigkeitsfunde: `xlsx` 0.18.5 (Prototype Pollution beim Mitglieder-Import, gepflegte Version nur vom SheetJS-CDN), `@nestjs/swagger` → `js-yaml` (Fix erst mit Major 12). |
| O16 | Content-Security-Policy am Reverse Proxy (Härtung der Sitzung im `localStorage`, E31). |
| O17 | PDF-Verarbeitung (`pdf-parse`) läuft im Backend-Prozess; Isolierung wäre ein Ausbau. |
| O19 | Release eines Backend-Images: `docker-release.yml` veröffentlicht nur das Frontend-Image. |
| — | Betreiber-Bestätigung von D1–D8, E19 und E26; Egress-Allowlist (O10); globales Login-Limit je E-Mail hinter einem zusätzlichen Proxy (E14). |
| — | OAuth-Anmeldung ist nicht umgesetzt (es gab keine OAuth-Konten). |
