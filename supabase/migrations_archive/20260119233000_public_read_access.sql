-- Allow public read access to events that are explicitly marked as 'public'
-- This enables the "Share Link" feature for non-logged-in users

DROP POLICY IF EXISTS "Public events are viewable by everyone" ON events;

CREATE POLICY "Public events are viewable by everyone" 
ON events FOR SELECT 
TO anon, authenticated
USING (
  'public' = ANY(allowed_roles)
);
