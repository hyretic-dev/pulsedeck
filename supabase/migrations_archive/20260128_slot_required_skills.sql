-- Add required_skills column to event_slots table for Smart Matching
-- This allows admins to specify which skills are needed for a helper slot

ALTER TABLE event_slots 
ADD COLUMN IF NOT EXISTS required_skills text[] DEFAULT '{}';

COMMENT ON COLUMN event_slots.required_skills IS 'Array of skill IDs required for this helper slot';
