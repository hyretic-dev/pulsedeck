-- Add working_group_id to feed_items
ALTER TABLE feed_items ADD COLUMN IF NOT EXISTS working_group_id UUID REFERENCES working_groups(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_feed_items_working_group_id ON feed_items(working_group_id);
