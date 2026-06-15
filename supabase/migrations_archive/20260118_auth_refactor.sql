-- ═══════════════════════════════════════════════════════════════════════════
-- AUTH SYSTEM REFACTORING
-- Supports multi-org membership per user
-- ═══════════════════════════════════════════════════════════════════════════

-- 1. Ensure email + organization_id is unique
-- A user can be member in multiple orgs, but only once per org
-- Drop if exists to make migration idempotent
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint 
        WHERE conname = 'members_email_org_unique'
    ) THEN
        ALTER TABLE members
        ADD CONSTRAINT members_email_org_unique UNIQUE (email, organization_id);
    END IF;
END $$;

-- 2. Create index for faster email lookups (used in login flow)
CREATE INDEX IF NOT EXISTS idx_members_email ON members(email);
CREATE INDEX IF NOT EXISTS idx_members_user_id ON members(user_id);

-- 3. RLS Policy: Allow unauthenticated users to check if email exists
-- This is needed for the login flow before authentication
DROP POLICY IF EXISTS "Public can check member emails" ON members;
CREATE POLICY "Public can check member emails" ON members
    FOR SELECT 
    USING (
        -- Allow selecting basic info for email lookup (no sensitive data exposed)
        -- The actual SELECT query should only request: id, email, user_id, organization_id
        true
    );

-- Note: We rely on the application to only SELECT necessary columns.
-- For stricter security, consider a separate "email_lookup" view.

-- 4. Add connection_token column if not exists (for invitation flow)
ALTER TABLE members 
ADD COLUMN IF NOT EXISTS connection_token TEXT;

-- Add index for token lookups
CREATE INDEX IF NOT EXISTS idx_members_connection_token ON members(connection_token);

COMMENT ON COLUMN members.connection_token IS 'One-time token for linking auth user to member profile';

-- 5. Grant public access to organizations for slug lookup
ALTER TABLE organizations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Public can read organizations" ON organizations;
CREATE POLICY "Public can read organizations" ON organizations
    FOR SELECT USING (true);

-- 6. Create function to get all memberships for a user
CREATE OR REPLACE FUNCTION get_user_memberships(user_uuid UUID)
RETURNS TABLE (
    member_id UUID,
    member_name TEXT,
    organization_id UUID,
    organization_name TEXT,
    organization_slug TEXT,
    app_role TEXT
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        m.id as member_id,
        m.name as member_name,
        o.id as organization_id,
        o.name as organization_name,
        o.slug as organization_slug,
        m.app_role
    FROM members m
    INNER JOIN organizations o ON m.organization_id = o.id
    WHERE m.user_id = user_uuid;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Grant execute to authenticated users
GRANT EXECUTE ON FUNCTION get_user_memberships(UUID) TO authenticated;

COMMENT ON FUNCTION get_user_memberships IS 'Returns all organization memberships for a given auth user UUID';
