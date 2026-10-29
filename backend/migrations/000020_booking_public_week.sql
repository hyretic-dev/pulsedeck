-- Up migration
-- Öffentliche Anzeige eines Belegungsplans: zusätzlich die Wochenansicht (laufende Kalenderwoche) als Startansicht der Besucher.
ALTER TABLE booking_calendars DROP CONSTRAINT booking_calendars_public_view_check;
ALTER TABLE booking_calendars ADD CONSTRAINT booking_calendars_public_view_check CHECK (public_view IN ('none', 'week', 'month', 'year'));

-- Down migration
UPDATE booking_calendars SET public_view = 'month' WHERE public_view = 'week';
ALTER TABLE booking_calendars DROP CONSTRAINT booking_calendars_public_view_check;
ALTER TABLE booking_calendars ADD CONSTRAINT booking_calendars_public_view_check CHECK (public_view IN ('none', 'year', 'month'));
