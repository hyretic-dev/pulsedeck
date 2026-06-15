-- Add poll configuration to feed_items
ALTER TABLE feed_items 
ADD COLUMN IF NOT EXISTS poll_config JSONB DEFAULT NULL;

-- Create poll options table
CREATE TABLE IF NOT EXISTS poll_options (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    feed_item_id UUID NOT NULL REFERENCES feed_items(id) ON DELETE CASCADE,
    text TEXT NOT NULL,
    sort_order INT DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Enable RLS on poll_options
ALTER TABLE poll_options ENABLE ROW LEVEL SECURITY;

-- Create poll votes table
CREATE TABLE IF NOT EXISTS poll_votes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    option_id UUID NOT NULL REFERENCES poll_options(id) ON DELETE CASCADE,
    member_id UUID NOT NULL REFERENCES members(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(option_id, member_id)
);

-- Enable RLS on poll_votes
ALTER TABLE poll_votes ENABLE ROW LEVEL SECURITY;

-- Policies for poll_options
CREATE POLICY "View poll options" ON poll_options FOR SELECT USING (
    EXISTS (
        SELECT 1 FROM feed_items
        JOIN members ON members.organization_id = feed_items.organization_id
        WHERE feed_items.id = poll_options.feed_item_id
        AND members.user_id = auth.uid()
    )
);

CREATE POLICY "Manage poll options" ON poll_options FOR ALL USING (
    EXISTS (
        SELECT 1 FROM feed_items
        WHERE feed_items.id = poll_options.feed_item_id
        AND feed_items.author_id IN (SELECT id FROM members WHERE user_id = auth.uid())
    )
);

-- Policies for poll_votes
CREATE POLICY "View votes" ON poll_votes FOR SELECT USING (
    EXISTS (
        SELECT 1 FROM poll_options
        JOIN feed_items ON feed_items.id = poll_options.feed_item_id
        JOIN members ON members.organization_id = feed_items.organization_id
        WHERE poll_options.id = poll_votes.option_id
        AND members.user_id = auth.uid()
    )
);

CREATE POLICY "Insert vote" ON poll_votes FOR INSERT WITH CHECK (
    member_id IN (SELECT id FROM members WHERE user_id = auth.uid())
    AND EXISTS (
        SELECT 1 FROM poll_options
        JOIN feed_items ON feed_items.id = poll_options.feed_item_id
        JOIN members m ON m.id = poll_votes.member_id
        WHERE poll_options.id = poll_votes.option_id
        AND m.organization_id = feed_items.organization_id
    )
);

CREATE POLICY "Delete vote" ON poll_votes FOR DELETE USING (
    member_id IN (SELECT id FROM members WHERE user_id = auth.uid())
);
