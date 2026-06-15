-- Ensure events are publicly readable
-- Drops any restrictive policies and recreates public access

-- Drop all existing SELECT policies on events to avoid conflicts
DO $$
DECLARE
    pol RECORD;
BEGIN
    FOR pol IN 
        SELECT policyname 
        FROM pg_policies 
        WHERE tablename = 'events' AND cmd = 'SELECT'
    LOOP
        EXECUTE format('DROP POLICY IF EXISTS %I ON events', pol.policyname);
    END LOOP;
END $$;

-- Create a single, clear public SELECT policy
CREATE POLICY "events_public_read" ON events
    FOR SELECT
    USING (true);

-- Ensure grants are set
GRANT SELECT ON events TO anon, authenticated, service_role;

-- Also ensure organizations are readable (needed for joins)
DO $$
DECLARE
    pol RECORD;
BEGIN
    FOR pol IN 
        SELECT policyname 
        FROM pg_policies 
        WHERE tablename = 'organizations' AND cmd = 'SELECT'
    LOOP
        EXECUTE format('DROP POLICY IF EXISTS %I ON organizations', pol.policyname);
    END LOOP;
END $$;

CREATE POLICY "organizations_public_read" ON organizations
    FOR SELECT
    USING (true);

GRANT SELECT ON organizations TO anon, authenticated, service_role;
