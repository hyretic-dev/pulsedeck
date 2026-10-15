-- Belegt die tatsächlichen Rechte im rekonstruierten Live-Schema (Replay, siehe replay.mjs).
-- Ausführung: node scripts/legacy-replay/replay.mjs &&
--   docker exec -i pulsedeck-pg-test psql -U postgres -d legacy_replay -q < scripts/legacy-replay/probe-permissions.sql
-- Alle Änderungen laufen in einer Transaktion und werden zurückgerollt.
-- Ergebnis 2026-10-13: anon darf contacts/working_groups löschen und events ändern/anlegen (A4–A7);
-- ein normales Mitglied liest fremde Dateien (B1/B2), legt Dateien in fremden Orgs an (B3), befördert
-- sich selbst zum admin (B5) und verschiebt seine Mitgliedschaft in eine fremde Org (B7/B8).
\set ON_ERROR_STOP off
\pset format unaligned
\pset tuples_only on
BEGIN;
-- Testdaten als Superuser: zwei Organisationen (Trigger legen Standardrollen/-skills an), drei Konten
INSERT INTO auth.users (id, email) VALUES
  ('aaaaaaaa-0000-4000-8000-000000000001','a@example.org'),
  ('bbbbbbbb-0000-4000-8000-000000000002','b@example.org');
INSERT INTO organizations (id, slug, name, owner_id) VALUES
  ('11111111-0000-4000-8000-000000000001','org1','Org Eins','aaaaaaaa-0000-4000-8000-000000000001'),
  ('22222222-0000-4000-8000-000000000002','org2','Org Zwei','bbbbbbbb-0000-4000-8000-000000000002');
INSERT INTO members (id, name, status, email, join_date, user_id, app_role, organization_id, role_id)
SELECT '33333333-0000-4000-8000-000000000001','Anna','Active','a@example.org','2026-01-01','aaaaaaaa-0000-4000-8000-000000000001','member','11111111-0000-4000-8000-000000000001', r.id
  FROM organization_roles r WHERE r.organization_id='11111111-0000-4000-8000-000000000001' AND r.is_default;
INSERT INTO members (id, name, status, email, join_date, user_id, app_role, organization_id, role_id)
SELECT '44444444-0000-4000-8000-000000000002','Bernd','Active','b@example.org','2026-01-01','bbbbbbbb-0000-4000-8000-000000000002','admin','22222222-0000-4000-8000-000000000002', r.id
  FROM organization_roles r WHERE r.organization_id='22222222-0000-4000-8000-000000000002' AND r.is_system_admin;
INSERT INTO contacts (name, role, description, email, location, organization_id) VALUES ('K2','r','d','k2@example.org','Ort','22222222-0000-4000-8000-000000000002');
INSERT INTO events (title, date, start_time, location, description, organization_id, allowed_roles) VALUES ('E2','2026-12-01','10:00','Ort','d','22222222-0000-4000-8000-000000000002','{member}');
INSERT INTO working_groups (name, description, lead, next_meeting, contact_type, contact_icon, organization_id) VALUES ('AG2','d','l','n','Email','pi-user','22222222-0000-4000-8000-000000000002');
INSERT INTO files (name, original_name, storage_path, organization_id, visibility, uploaded_by) VALUES ('geheim.pdf','geheim.pdf','org2/geheim.pdf','22222222-0000-4000-8000-000000000002','member','44444444-0000-4000-8000-000000000002');
INSERT INTO storage.buckets (id, name) VALUES ('files','files');
INSERT INTO storage.objects (bucket_id, name) VALUES ('files','org2/geheim.pdf');
INSERT INTO active_sessions (user_id, name) VALUES ('bbbbbbbb-0000-4000-8000-000000000002','Bernd');

SELECT '--- A) ANONYM (kein Login) ---';
SET LOCAL ROLE anon;
SELECT 'A1 anon liest organizations: ' || count(*) FROM organizations;
SELECT 'A2 anon liest active_sessions (fremde Org): ' || count(*) FROM active_sessions;
SELECT 'A3 anon liest events/contacts/working_groups: ' || (SELECT count(*) FROM events) || '/' || (SELECT count(*) FROM contacts) || '/' || (SELECT count(*) FROM working_groups);
WITH d AS (DELETE FROM contacts RETURNING 1) SELECT 'A4 anon LÖSCHT contacts: ' || count(*) || ' Zeile(n)' FROM d;
WITH u AS (UPDATE events SET title = 'GEHACKT' RETURNING 1) SELECT 'A5 anon ÄNDERT events: ' || count(*) || ' Zeile(n)' FROM u;
WITH d AS (DELETE FROM working_groups RETURNING 1) SELECT 'A6 anon LÖSCHT working_groups: ' || count(*) || ' Zeile(n)' FROM d;
INSERT INTO events (title, date, start_time, location, description, organization_id) VALUES ('Spam','2026-12-24','00:00','x','x','22222222-0000-4000-8000-000000000002') RETURNING 'A7 anon LEGT Event in fremder Org an: ' || id::text;
SELECT 'A8 anon liest members: ' || count(*) FROM members;
SELECT 'A9 anon liest files: ' || count(*) FROM files;
RESET ROLE;

SELECT '--- B) ANGEMELDET als Anna (nur Mitglied in Org1, Rolle member) ---';
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','aaaaaaaa-0000-4000-8000-000000000001', true);
SELECT 'B1 Anna liest files fremder Org (member-Sichtbarkeit): ' || count(*) FROM files WHERE organization_id='22222222-0000-4000-8000-000000000002';
SELECT 'B2 Anna liest Storage-Objekte fremder Org: ' || count(*) FROM storage.objects WHERE name LIKE 'org2/%';
INSERT INTO files (name, original_name, storage_path, organization_id, visibility, uploaded_by) VALUES ('x','x','org2/x','22222222-0000-4000-8000-000000000002','public','33333333-0000-4000-8000-000000000001') RETURNING 'B3 Anna LEGT Datei in FREMDER Org an: ' || id::text;
SELECT 'B4 Anna liest working_group_members/ag_memberships/event_registrations: ' || (SELECT count(*) FROM working_group_members) || '/' || (SELECT count(*) FROM ag_memberships) || '/' || (SELECT count(*) FROM event_registrations);
WITH u AS (UPDATE members SET app_role = 'admin', permissions = ARRAY['feed:approve','wiki:edit'] WHERE user_id = 'aaaaaaaa-0000-4000-8000-000000000001' RETURNING app_role) SELECT 'B5 Anna SETZT SICH SELBST auf app_role=' || (SELECT app_role FROM u) FROM u;
SELECT 'B6 get_my_role() danach: ' || get_my_role();
WITH u AS (UPDATE members SET organization_id = '22222222-0000-4000-8000-000000000002' WHERE user_id = 'aaaaaaaa-0000-4000-8000-000000000001' RETURNING organization_id) SELECT 'B7 Anna VERSETZT ihre Mitgliedschaft in die FREMDE Org (als admin): ' || count(*) || ' Zeile(n)' FROM u;
SELECT 'B8 is_admin_of_org(Org2) danach: ' || is_admin_of_org('22222222-0000-4000-8000-000000000002');
RESET ROLE;
ROLLBACK;
