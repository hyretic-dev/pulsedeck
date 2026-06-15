-- Drop the existing check constraint
ALTER TABLE feed_items DROP CONSTRAINT IF EXISTS feed_items_type_check;

-- Add the new check constraint including 'poll'
ALTER TABLE feed_items ADD CONSTRAINT feed_items_type_check 
CHECK (type IN ('article', 'link', 'poll'));
