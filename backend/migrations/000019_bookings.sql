-- Up migration
-- Belegungspläne (Räume, Hallen, Gebäude, Gegenstände) mit Anfragen, Buchungen und Serien:
--  * ein Belegungsplan steht für genau einen Ort oder Gegenstand; Rollen je Plan unabhängig von den Organisationsrollen
--  * alle Tabellen tragen organization_id und Verbund-Fremdschlüssel (Plan, Mitglied, Termin gehören zur selben Organisation)
--  * zwei angenommene Buchungen desselben Plans überschneiden sich nie (Exclusion Constraint); offene Anfragen sind
--    Planungszeiten und dürfen sich überschneiden
--  * Titel und Öffentlichkeit einer mit einem Termin verknüpften Buchung kommen beim Lesen aus dem Termin (kein Kopieren)
-- btree_gist ist eine „trusted“ Extension: die Migrations-Rolle darf sie als Datenbank-Owner anlegen (wie citext, pgcrypto).
CREATE EXTENSION IF NOT EXISTS btree_gist;

-- Ziele der Verbund-Fremdschlüssel (id ist bereits Primärschlüssel, die Eindeutigkeit also trivial)
ALTER TABLE members ADD CONSTRAINT members_id_org_key UNIQUE (id, organization_id);
ALTER TABLE events ADD CONSTRAINT events_id_org_key UNIQUE (id, organization_id);

CREATE TABLE booking_calendars (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  name text NOT NULL CONSTRAINT booking_calendars_name_check CHECK (char_length(name) BETWEEN 1 AND 80),
  kind text NOT NULL CONSTRAINT booking_calendars_kind_check CHECK (kind IN ('place', 'item')),
  address text CONSTRAINT booking_calendars_address_check CHECK (char_length(address) <= 200),
  -- Bundesland für die Feiertage; leer = nur bundesweite Feiertage
  state text CONSTRAINT booking_calendars_state_check CHECK (state IN
    ('BW', 'BY', 'BE', 'BB', 'HB', 'HH', 'HE', 'MV', 'NI', 'NW', 'RP', 'SL', 'SN', 'ST', 'SH', 'TH')),
  -- Zeitfenster in vollen Stunden (Europe/Berlin); window_end ist exklusiv
  window_start smallint NOT NULL DEFAULT 8,
  window_end smallint NOT NULL DEFAULT 22,
  all_members_can_request boolean NOT NULL DEFAULT false,
  public_view text NOT NULL DEFAULT 'none' CONSTRAINT booking_calendars_public_view_check CHECK (public_view IN ('none', 'year', 'month')),
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT booking_calendars_window_check CHECK (window_start >= 0 AND window_end <= 24 AND window_end > window_start),
  UNIQUE (id, organization_id)
);
CREATE INDEX idx_booking_calendars_org ON booking_calendars (organization_id, sort_order, name);

CREATE TABLE booking_calendar_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  calendar_id uuid NOT NULL,
  member_id uuid NOT NULL,
  role text NOT NULL CONSTRAINT booking_calendar_members_role_check CHECK (role IN ('lead', 'manager', 'requester')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (calendar_id, member_id),
  FOREIGN KEY (calendar_id, organization_id) REFERENCES booking_calendars (id, organization_id) ON DELETE CASCADE,
  FOREIGN KEY (member_id, organization_id) REFERENCES members (id, organization_id) ON DELETE CASCADE
);
CREATE INDEX idx_booking_calendar_members_member ON booking_calendar_members (member_id);

CREATE TABLE booking_series (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  calendar_id uuid NOT NULL,
  member_id uuid,
  title text NOT NULL CONSTRAINT booking_series_title_check CHECK (char_length(title) BETWEEN 1 AND 120),
  note text CONSTRAINT booking_series_note_check CHECK (char_length(note) <= 1000),
  is_public boolean NOT NULL DEFAULT false,
  -- 0 = Montag … 6 = Sonntag
  weekdays smallint[] NOT NULL CONSTRAINT booking_series_weekdays_check CHECK (cardinality(weekdays) BETWEEN 1 AND 7 AND weekdays <@ ARRAY[0, 1, 2, 3, 4, 5, 6]::smallint[]),
  every_n_weeks smallint NOT NULL DEFAULT 1 CONSTRAINT booking_series_rhythm_check CHECK (every_n_weeks BETWEEN 1 AND 4),
  hour_from smallint NOT NULL,
  hour_to smallint NOT NULL,
  valid_from date NOT NULL,
  valid_to date NOT NULL,
  skip_holidays boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT booking_series_hours_check CHECK (hour_from >= 0 AND hour_to <= 24 AND hour_to > hour_from),
  CONSTRAINT booking_series_period_check CHECK (valid_to >= valid_from AND valid_to <= (valid_from + interval '12 months')::date),
  UNIQUE (id, organization_id),
  FOREIGN KEY (calendar_id, organization_id) REFERENCES booking_calendars (id, organization_id) ON DELETE CASCADE,
  FOREIGN KEY (member_id, organization_id) REFERENCES members (id, organization_id) ON DELETE SET NULL (member_id)
);
CREATE INDEX idx_booking_series_calendar ON booking_series (calendar_id);

CREATE TABLE bookings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  calendar_id uuid NOT NULL,
  -- anfragende bzw. anlegende Person (heißt member_id, damit der Datenexport sie findet)
  member_id uuid,
  -- Null nur bei verknüpften Buchungen: Titel und Öffentlichkeit kommen dann aus dem Termin
  title text CONSTRAINT bookings_title_check CHECK (char_length(title) BETWEEN 1 AND 120),
  note text CONSTRAINT bookings_note_check CHECK (char_length(note) <= 1000),
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  status text NOT NULL CONSTRAINT bookings_status_check CHECK (status IN ('requested', 'approved', 'declined', 'cancelled')),
  is_public boolean NOT NULL DEFAULT false,
  event_id uuid,
  series_id uuid,
  decided_by uuid,
  decided_at timestamptz,
  decision_reason text CONSTRAINT bookings_reason_check CHECK (char_length(decision_reason) <= 500),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT bookings_title_needed_check CHECK (event_id IS NOT NULL OR title IS NOT NULL),
  CONSTRAINT bookings_span_check CHECK (ends_at > starts_at AND ends_at - starts_at <= interval '14 days'),
  -- volle Stunden
  CONSTRAINT bookings_full_hours_check CHECK (
    extract(epoch FROM starts_at)::bigint % 3600 = 0 AND extract(epoch FROM ends_at)::bigint % 3600 = 0),
  FOREIGN KEY (calendar_id, organization_id) REFERENCES booking_calendars (id, organization_id) ON DELETE CASCADE,
  FOREIGN KEY (member_id, organization_id) REFERENCES members (id, organization_id) ON DELETE SET NULL (member_id),
  FOREIGN KEY (decided_by, organization_id) REFERENCES members (id, organization_id) ON DELETE SET NULL (decided_by),
  -- Termin gelöscht → Buchung entfällt, der Ort ist frei
  FOREIGN KEY (event_id, organization_id) REFERENCES events (id, organization_id) ON DELETE CASCADE,
  FOREIGN KEY (series_id, organization_id) REFERENCES booking_series (id, organization_id) ON DELETE SET NULL (series_id),
  -- Kernregel: angenommene Buchungen desselben Plans überschneiden sich nie
  CONSTRAINT bookings_no_overlap EXCLUDE USING gist (
    calendar_id WITH =, tstzrange(starts_at, ends_at, '[)') WITH &&
  ) WHERE (status = 'approved')
);
-- Ein Termin hat höchstens eine wirksame Buchung; stornierte bleiben als Verlauf (Ort entfernen oder wechseln)
CREATE UNIQUE INDEX bookings_event_active_key ON bookings (event_id) WHERE event_id IS NOT NULL AND status IN ('requested', 'approved');
CREATE INDEX idx_bookings_calendar_time ON bookings (calendar_id, starts_at);
CREATE INDEX idx_bookings_org_status ON bookings (organization_id, status);
CREATE INDEX idx_bookings_member ON bookings (member_id);
CREATE INDEX idx_bookings_series ON bookings (series_id) WHERE series_id IS NOT NULL;

GRANT SELECT, INSERT, UPDATE, DELETE ON booking_calendars, booking_calendar_members, booking_series, bookings TO pulsedeck_runtime;

-- Down migration
REVOKE SELECT, INSERT, UPDATE, DELETE ON booking_calendars, booking_calendar_members, booking_series, bookings FROM pulsedeck_runtime;
DROP TABLE bookings;
DROP TABLE booking_series;
DROP TABLE booking_calendar_members;
DROP TABLE booking_calendars;
ALTER TABLE events DROP CONSTRAINT events_id_org_key;
ALTER TABLE members DROP CONSTRAINT members_id_org_key;
-- btree_gist bleibt installiert (andere Migrationen dürfen sie voraussetzen); Entfernen wäre ein separater Eingriff.
