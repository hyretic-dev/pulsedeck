-- Migration: Event & Member Enhancements
-- Adds meeting_reason, location_type, recurring event fields
-- to events and contact_channels to members.

-- 1. Event: Meeting Reason & Location Type
ALTER TABLE events
  ADD COLUMN IF NOT EXISTS meeting_reason TEXT;

ALTER TABLE events
  ADD COLUMN IF NOT EXISTS location_type TEXT
  CHECK (location_type IN ('discord', 'zoom', 'onsite', 'other'));

-- 2. Event: Recurring Events
ALTER TABLE events
  ADD COLUMN IF NOT EXISTS is_recurring BOOLEAN
  DEFAULT false;

ALTER TABLE events
  ADD COLUMN IF NOT EXISTS recurrence_interval TEXT
  CHECK (
    recurrence_interval IN ('biweekly', 'monthly', 'quarterly')
  );

ALTER TABLE events
  ADD COLUMN IF NOT EXISTS recurrence_parent_id UUID
  REFERENCES events(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_events_recurrence_parent
  ON events(recurrence_parent_id)
  WHERE recurrence_parent_id IS NOT NULL;

-- 3. Members: Contact Channels
ALTER TABLE members
  ADD COLUMN IF NOT EXISTS contact_channels JSONB
  DEFAULT '{}';

COMMENT ON COLUMN events.meeting_reason IS
  'Reason/purpose for the meeting';
COMMENT ON COLUMN events.location_type IS
  'Type of meeting location: discord, zoom, onsite, other';
COMMENT ON COLUMN events.is_recurring IS
  'Whether this event is part of a recurring series';
COMMENT ON COLUMN events.recurrence_interval IS
  'Interval: biweekly, monthly, quarterly';
COMMENT ON COLUMN events.recurrence_parent_id IS
  'Reference to the first event in a recurring series';
COMMENT ON COLUMN members.contact_channels IS
  'JSONB with contact info, e.g. {"Discord":"user#123","WhatsApp":"+49..."}';
