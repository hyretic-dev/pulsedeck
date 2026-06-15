-- Remove the type column from events table
-- Event type is now derived from working_group_id:
-- - working_group_id IS NOT NULL -> AG event
-- - working_group_id IS NULL -> General event

ALTER TABLE public.events DROP COLUMN IF EXISTS type;
