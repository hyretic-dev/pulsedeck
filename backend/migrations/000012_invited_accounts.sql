-- Up migration
-- Eingeladene Konten (Admin-Einladung, E-Mail-Prüfung der Login-Seite) haben kein Passwort: wie bei
-- Supabase-Einladungen melden sie sich über den Link passwortlos an und können später eines setzen.
-- password_set unterscheidet „Passwort gesetzt“ von „zufälliger, unbenutzbarer Hash“.
ALTER TABLE auth_users ADD COLUMN password_set boolean NOT NULL DEFAULT true;

-- Down migration
ALTER TABLE auth_users DROP COLUMN password_set;
