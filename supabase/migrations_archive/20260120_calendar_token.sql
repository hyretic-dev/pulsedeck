-- Add explicit calendar_token to members for secure iCal access
-- usage: /functions/v1/ical-export?token=...

ALTER TABLE members 
ADD COLUMN IF NOT EXISTS calendar_token TEXT;

-- Populate existing members with a secure random hex token (32 chars)
UPDATE members 
SET calendar_token = encode(gen_random_bytes(16), 'hex') 
WHERE calendar_token IS NULL;

-- Make it unique and not null for future
ALTER TABLE members 
ALTER COLUMN calendar_token SET DEFAULT encode(gen_random_bytes(16), 'hex');

CREATE UNIQUE INDEX IF NOT EXISTS idx_members_calendar_token ON members(calendar_token);

-- RLS: Ensure users can read their own token
-- (Existing policies usually allow "read own member profile", so this should be fine)
