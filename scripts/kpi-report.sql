-- Wochenreport der Pilot-KPIs (nur lesend). Aufruf auf dem Server, z. B.:
--   docker compose exec -T postgres psql -U postgres -d pulsedeck -f - < scripts/kpi-report.sql
-- (Benutzer und Datenbank wie im Compose-Projekt.) Es werden keine Personendaten ausgegeben, nur Zähler je Organisation.
--
-- Nicht aus der Datenbank, sondern aus Gesprächen: Ausgangswerte vom Kickoff (Kernaktive, Stunden pro Woche), Sean-Ellis-Test
-- (siehe Abschnitt 6, wenn die Umfrage in der Organisation „PulseDeck Piloten“ läuft) und Zahlungsbereitschaft.
--
-- Interne Organisationen (Demo, Piloten-Organisation) zählen nicht mit; Kürzel hier anpassen:
\set intern '''demo-ortsverband'',''pulsedeck-piloten'''

\pset null '-'
\pset footer off

CREATE TEMP VIEW kpi_orgs AS
  SELECT o.id, o.slug, o.name, o.created_at, o.acquisition_source, o.acquisition_ref, o.pilot_requested
    FROM organizations o
   WHERE o.slug NOT IN (:intern);

-- 1. Aktivierung: innerhalb von 14 Tagen nach Gründung mindestens 1 Arbeitsgruppe oder Serientermin, mindestens 5 Mitglieder
--    und mindestens 3 weitere Personen (nicht die Gründerin), die sich in eine Schicht oder einen Termin eintragen.
--    Nur Organisationen, die älter als 14 Tage sind (sonst ist das Fenster noch offen).
\echo
\echo '== 1. Aktivierung (Organisationen älter als 14 Tage)'
WITH reif AS (
  SELECT * FROM kpi_orgs WHERE created_at <= now() - interval '14 days'
), flags AS (
  SELECT r.id, r.slug, r.acquisition_source AS herkunft,
    (EXISTS (SELECT 1 FROM working_groups g WHERE g.organization_id = r.id AND g.created_at <= r.created_at + interval '14 days')
     OR EXISTS (SELECT 1 FROM events e WHERE e.organization_id = r.id AND (e.is_recurring OR e.recurrence_parent_id IS NOT NULL) AND e.created_at <= r.created_at + interval '14 days')) AS struktur,
    (SELECT count(*) FROM members m WHERE m.organization_id = r.id AND m.created_at <= r.created_at + interval '14 days') >= 5 AS mitglieder,
    (SELECT count(DISTINCT x.member_id) FROM (
        SELECT s.member_id FROM event_slot_signups s WHERE s.organization_id = r.id AND s.status = 'confirmed' AND s.signed_up_at <= r.created_at + interval '14 days'
        UNION
        SELECT er.member_id FROM event_registrations er JOIN events e ON e.id = er.event_id
         WHERE e.organization_id = r.id AND er.status <> 'cancelled' AND er.registered_at <= r.created_at + interval '14 days') x
      JOIN members m ON m.id = x.member_id
      JOIN organizations o ON o.id = r.id
     WHERE m.user_id IS DISTINCT FROM o.owner_id) >= 3 AS beteiligung
  FROM reif r
)
SELECT count(*) AS organisationen,
       count(*) FILTER (WHERE struktur AND mitglieder AND beteiligung) AS aktiviert,
       round(100.0 * count(*) FILTER (WHERE struktur AND mitglieder AND beteiligung) / NULLIF(count(*), 0)) AS aktivierung_prozent,
       count(*) FILTER (WHERE NOT struktur) AS ohne_struktur,
       count(*) FILTER (WHERE NOT mitglieder) AS unter_5_mitglieder,
       count(*) FILTER (WHERE NOT beteiligung) AS ohne_beteiligung
  FROM flags;

-- 2. Verteilung der Arbeit: Personen je Organisation und Monat, die sich in mindestens eine Schicht eintragen. Vergleich mit den
--    Kernaktiven aus dem Kickoff (Ziel: das 1,5-Fache nach 2 Monaten).
\echo
\echo '== 2. Verteilung der Arbeit: Personen mit Schicht-Zusage je Organisation und Monat (letzte 3 Monate)'
SELECT o.slug AS organisation, to_char(date_trunc('month', s.signed_up_at), 'YYYY-MM') AS monat,
       count(DISTINCT s.member_id) AS personen, count(*) AS zusagen
  FROM event_slot_signups s JOIN kpi_orgs o ON o.id = s.organization_id
 WHERE s.status = 'confirmed' AND s.signed_up_at >= date_trunc('month', now()) - interval '2 months'
 GROUP BY 1, 2 ORDER BY 1, 2;

-- 3. Aktives Kernteam: Wochen der letzten vier, in denen mindestens 2 verschiedene Konten Inhalte angelegt oder bearbeitet haben
--    (Protokoll: Termine, Beiträge, Wiki, Dateien, Arbeitsgruppen, Mitglieder). Ziel: mindestens 3 von 4 Wochen.
\echo
\echo '== 3. Aktives Kernteam (letzte 4 Wochen)'
CREATE TEMP VIEW kpi_wochen AS
  SELECT o.id, o.slug, w.n,
         (SELECT count(DISTINCT a.performed_by) FROM audit_logs a
           WHERE a.organization_id = o.id AND a.performed_by IS NOT NULL
             AND a.created_at >= date_trunc('week', now()) - make_interval(weeks => w.n)
             AND a.created_at <  date_trunc('week', now()) - make_interval(weeks => w.n - 1)) AS konten
    FROM kpi_orgs o CROSS JOIN generate_series(1, 4) AS w(n)
   WHERE o.created_at <= now() - interval '4 weeks';

SELECT slug AS organisation, count(*) FILTER (WHERE konten >= 2) AS wochen_aktiv, count(*) FILTER (WHERE konten >= 2) >= 3 AS kernteam_aktiv
  FROM kpi_wochen GROUP BY slug ORDER BY slug;
SELECT count(*) AS organisationen, count(*) FILTER (WHERE wochen_aktiv >= 3) AS aktiv,
       round(100.0 * count(*) FILTER (WHERE wochen_aktiv >= 3) / NULLIF(count(*), 0)) AS aktiv_prozent
  FROM (SELECT slug, count(*) FILTER (WHERE konten >= 2) AS wochen_aktiv FROM kpi_wochen GROUP BY slug) t;

-- 4. Mitglieder-Reichweite: Anteil der Mitglieder mit verknüpftem Konto (Link bestätigt = mindestens einmal angemeldet),
--    für Organisationen ab 30 Tagen. Ziel: mindestens 40 %.
\echo
\echo '== 4. Mitglieder-Reichweite (Organisationen älter als 30 Tage)'
SELECT o.slug AS organisation, count(*) AS mitglieder, count(m.user_id) AS mit_konto,
       round(100.0 * count(m.user_id) / NULLIF(count(*), 0)) AS prozent
  FROM kpi_orgs o JOIN members m ON m.organization_id = o.id AND m.status <> 'Inactive'
 WHERE o.created_at <= now() - interval '30 days'
 GROUP BY o.slug ORDER BY o.slug;

-- 5. Infos kommen an: Anteil aktiver Mitglieder, die angepinnte Beiträge innerhalb von 7 Tagen lesen (Beiträge, die mindestens
--    7 Tage alt sind). Ziel: mindestens 60 %.
\echo
\echo '== 5. Angepinnte Beiträge gelesen (innerhalb von 7 Tagen)'
WITH beitraege AS (
  SELECT f.id, f.organization_id, COALESCE(f.sent_at, f.created_at) AS seit
    FROM feed_items f JOIN kpi_orgs o ON o.id = f.organization_id
   WHERE f.is_pinned AND f.status IN ('approved', 'sent') AND COALESCE(f.sent_at, f.created_at) <= now() - interval '7 days'
)
SELECT o.slug AS organisation, count(DISTINCT b.id) AS beitraege,
       count(DISTINCT (b.id, r.member_id)) AS gelesen,
       count(DISTINCT b.id) * (SELECT count(*) FROM members m WHERE m.organization_id = o.id AND m.status = 'Active') AS moeglich,
       round(100.0 * count(DISTINCT (b.id, r.member_id))
             / NULLIF(count(DISTINCT b.id) * (SELECT count(*) FROM members m WHERE m.organization_id = o.id AND m.status = 'Active'), 0)) AS prozent
  FROM beitraege b JOIN kpi_orgs o ON o.id = b.organization_id
  LEFT JOIN feed_item_reads r ON r.feed_item_id = b.id AND r.read_at <= b.seit + interval '7 days'
 GROUP BY o.id, o.slug ORDER BY o.slug;

-- 6. Sean-Ellis-Test: Ergebnis einer Umfrage im Feed („Wie enttäuscht wärst du, wenn es PulseDeck nicht mehr gäbe?“ mit den
--    Antworten „sehr“, „etwas“, „gar nicht“). Titel der Umfrage muss „enttäuscht“ enthalten. Ziel: ≥ 40 % „sehr“, n ≥ 15.
\echo
\echo '== 6. Sean-Ellis-Test (Umfrage mit „enttäuscht“ im Titel)'
SELECT f.title AS umfrage, p.text AS antwort, count(v.id) AS stimmen,
       round(100.0 * count(v.id) / NULLIF(sum(count(v.id)) OVER (PARTITION BY f.id), 0)) AS prozent
  FROM feed_items f JOIN poll_options p ON p.feed_item_id = f.id LEFT JOIN poll_votes v ON v.option_id = p.id
 WHERE f.type = 'poll' AND f.title ILIKE '%enttäuscht%'
 GROUP BY f.id, f.title, p.id, p.text, p.sort_order ORDER BY f.title, p.sort_order;

-- 7. Herkunft und organisches Wachstum: neue Organisationen je Monat nach Herkunft. Organisch = Empfehlung, Gast-Einladung
--    oder öffentliche Seiten (ref event, orgseite, gast). Ziel: mindestens 25 %.
\echo
\echo '== 7. Herkunft neuer Organisationen (letzte 6 Monate)'
SELECT to_char(date_trunc('month', created_at), 'YYYY-MM') AS monat,
       COALESCE(acquisition_source, 'keine Angabe') AS herkunft,
       COALESCE(acquisition_ref, '-') AS ref, count(*) AS organisationen
  FROM kpi_orgs WHERE created_at >= date_trunc('month', now()) - interval '5 months'
 GROUP BY 1, 2, 3 ORDER BY 1 DESC, 4 DESC;
SELECT count(*) AS neue_organisationen,
       count(*) FILTER (WHERE acquisition_source IN ('empfehlung', 'event_gast') OR acquisition_ref IN ('event', 'orgseite', 'gast')) AS organisch,
       round(100.0 * count(*) FILTER (WHERE acquisition_source IN ('empfehlung', 'event_gast') OR acquisition_ref IN ('event', 'orgseite', 'gast')) / NULLIF(count(*), 0)) AS organisch_prozent
  FROM kpi_orgs WHERE created_at >= now() - interval '90 days';

-- 8. Offene Pilot-Anfragen (Einrichtungsgespräch noch nicht geführt: Notiz im Feedback-Board oder Organisationsname hier prüfen)
\echo
\echo '== 8. Pilot-Anfragen'
SELECT o.slug AS organisation, o.name, o.created_at::date AS angelegt, o.pilot_wish AS wunschzeitraum
  FROM organizations o WHERE o.pilot_requested AND o.slug NOT IN (:intern) ORDER BY o.created_at DESC;

-- 9. Feedback-Board: Themen nach Zahl der Organisationen (Bau-Regel: mindestens 3)
\echo
\echo '== 9. Feedback-Themen'
SELECT topic, count(DISTINCT organization_id) AS organisationen, count(*) AS meldungen,
       count(*) FILTER (WHERE blocks_activation) AS blockiert_aktivierung,
       count(*) FILTER (WHERE status NOT IN ('done', 'live')) AS offen,
       count(*) FILTER (WHERE status IN ('done', 'live') AND replied_at IS NULL) AS ohne_rueckmeldung
  FROM feedback_submissions WHERE topic IS NOT NULL GROUP BY topic ORDER BY organisationen DESC, meldungen DESC;
