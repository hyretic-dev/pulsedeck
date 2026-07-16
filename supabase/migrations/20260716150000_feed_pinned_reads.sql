-- 1. Add is_pinned to feed_items
ALTER TABLE public.feed_items ADD COLUMN IF NOT EXISTS is_pinned BOOLEAN NOT NULL DEFAULT false;

-- Create index for quick sorting of pinned items
CREATE INDEX IF NOT EXISTS idx_feed_items_is_pinned ON public.feed_items(is_pinned) WHERE is_pinned = true;

-- 2. Create feed_item_reads table for Lesebestätigungen
CREATE TABLE IF NOT EXISTS public.feed_item_reads (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    feed_item_id UUID NOT NULL REFERENCES public.feed_items(id) ON DELETE CASCADE,
    member_id UUID NOT NULL REFERENCES public.members(id) ON DELETE CASCADE,
    read_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE(feed_item_id, member_id) -- A member can only have one read receipt per item
);

-- Enable RLS for feed_item_reads
ALTER TABLE public.feed_item_reads ENABLE ROW LEVEL SECURITY;

-- Drop existing policies if they exist (for idempotency)
DROP POLICY IF EXISTS "Members can insert their own read receipt" ON public.feed_item_reads;
DROP POLICY IF EXISTS "Members can see their own read receipts" ON public.feed_item_reads;
DROP POLICY IF EXISTS "Admins and Authors can see all read receipts for their items" ON public.feed_item_reads;

-- 3. RLS Policies
-- Members can insert a read receipt for themselves
CREATE POLICY "Members can insert their own read receipt" 
ON public.feed_item_reads FOR INSERT 
WITH CHECK (member_id = (SELECT id FROM public.members WHERE user_id = auth.uid() LIMIT 1));

-- Members can view their own read receipts
CREATE POLICY "Members can see their own read receipts" 
ON public.feed_item_reads FOR SELECT 
USING (member_id = (SELECT id FROM public.members WHERE user_id = auth.uid() LIMIT 1));

-- Admins and original authors can view all read receipts (to see who read what)
CREATE POLICY "Admins and Authors can see all read receipts for their items" 
ON public.feed_item_reads FOR SELECT 
USING (
    get_my_role() = 'admin' OR 
    EXISTS (
        SELECT 1 FROM public.feed_items 
        WHERE id = feed_item_reads.feed_item_id 
        AND author_id = (SELECT id FROM public.members WHERE user_id = auth.uid() LIMIT 1)
    )
);
