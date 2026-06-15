-- Ensure public read access for Events and Organizations
-- This handles both RLS Policies and Role Grants

-- 1. Organizations
ALTER TABLE organizations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Public can read organizations" ON organizations;
CREATE POLICY "Public can read organizations" ON organizations
    FOR SELECT USING (true);

-- Explicitly grant SELECT permission to anon/authenticated roles
GRANT SELECT ON organizations TO anon, authenticated, service_role;


-- 2. Events
ALTER TABLE events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Public events are viewable by everyone" ON events;
CREATE POLICY "Public events are viewable by everyone" ON events
    FOR SELECT USING (true);

GRANT SELECT ON events TO anon, authenticated, service_role;


-- 3. Working Groups (Often needed for event context)
ALTER TABLE working_groups ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Public can read working groups" ON working_groups;
CREATE POLICY "Public can read working groups" ON working_groups
    FOR SELECT USING (true);

GRANT SELECT ON working_groups TO anon, authenticated, service_role;
