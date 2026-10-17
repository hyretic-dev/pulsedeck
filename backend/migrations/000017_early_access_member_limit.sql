-- Up migration
-- Early Access: alle Funktionen kostenlos und ohne Mitgliederlimit. Die Prüfung in members.service (pruefeKapazitaet) bleibt
-- bestehen; das Limit ist nur so hoch, dass es praktisch nicht greift. Nach dem Early Access gilt für den kostenlosen Tarif wieder
-- 10 (Standard zurücksetzen und betroffene Organisationen gezielt anpassen).
ALTER TABLE organizations ALTER COLUMN max_members SET DEFAULT 9999;
-- Nur Organisationen mit dem bisherigen Standardwert; bewusst anders gesetzte Grenzen bleiben.
UPDATE organizations SET max_members = 9999 WHERE subscription_tier = 'free' AND max_members = 10;

-- Down migration
ALTER TABLE organizations ALTER COLUMN max_members SET DEFAULT 10;
