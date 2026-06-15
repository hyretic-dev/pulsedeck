-- Enable RLS specifically for public access

-- EVENTS
-- Check if allowed_roles exists, if not assume visibility column or create it?
-- Based on code, events uses allowed_roles (text array or jsonb)
-- We enable public access if allowed_roles contains 'public'

ALTER TABLE events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Public events are viewable by everyone" ON events;
CREATE POLICY "Public events are viewable by everyone" ON events
FOR SELECT TO anon, authenticated
USING (
    allowed_roles @> ARRAY['public']::text[] 
    OR 
    visibility = 'public' -- Backup if mixed usage
);

-- WIKI DOCS (table name is wiki_docs)
-- Ensure RLS is enabled
ALTER TABLE wiki_docs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Public wiki docs are viewable by everyone" ON wiki_docs;
CREATE POLICY "Public wiki docs are viewable by everyone" ON wiki_docs
FOR SELECT TO anon, authenticated
USING (visibility = 'public');

-- FEED ITEMS
ALTER TABLE feed_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Public feed items are viewable by everyone" ON feed_items;
CREATE POLICY "Public feed items are viewable by everyone" ON feed_items
FOR SELECT TO anon, authenticated
USING (visibility = 'public' AND status IN ('approved', 'sent'));
