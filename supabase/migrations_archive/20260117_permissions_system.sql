-- ═══════════════════════════════════════════════════════════════════════════
-- PERMISSIONS SYSTEM MIGRATION
-- Adds flexible permissions for members and AG-specific roles
-- ═══════════════════════════════════════════════════════════════════════════

-- 1. Add permissions array to members table
ALTER TABLE members 
ADD COLUMN IF NOT EXISTS permissions TEXT[] DEFAULT '{}';

-- Add comment for documentation
COMMENT ON COLUMN members.permissions IS 'Array of permission keys: feed:create, feed:approve, wiki:edit, events:create, contacts:edit';

-- 2. Create AG memberships table with roles (if not exists, or alter existing)
-- First check if table exists and add role column
DO $$
BEGIN
    -- Add role column to ag_memberships if it exists
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'ag_memberships') THEN
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                       WHERE table_name = 'ag_memberships' AND column_name = 'role') THEN
            ALTER TABLE ag_memberships 
            ADD COLUMN role TEXT DEFAULT 'member' CHECK (role IN ('member', 'admin', 'lead'));
        END IF;
    ELSE
        -- Create the table if it doesn't exist
        CREATE TABLE ag_memberships (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            member_id UUID NOT NULL REFERENCES members(id) ON DELETE CASCADE,
            working_group_id UUID NOT NULL REFERENCES working_groups(id) ON DELETE CASCADE,
            role TEXT DEFAULT 'member' CHECK (role IN ('member', 'admin', 'lead')),
            joined_at TIMESTAMPTZ DEFAULT now(),
            UNIQUE(member_id, working_group_id)
        );
        
        -- Enable RLS
        ALTER TABLE ag_memberships ENABLE ROW LEVEL SECURITY;
        
        -- Create index
        CREATE INDEX IF NOT EXISTS idx_ag_memberships_member ON ag_memberships(member_id);
        CREATE INDEX IF NOT EXISTS idx_ag_memberships_group ON ag_memberships(working_group_id);
    END IF;
END $$;

-- 3. RLS Policies for ag_memberships
-- Everyone can view memberships
DROP POLICY IF EXISTS "Anyone can view AG memberships" ON ag_memberships;
CREATE POLICY "Anyone can view AG memberships" ON ag_memberships
    FOR SELECT USING (true);

-- Members can join AGs (insert their own membership)
DROP POLICY IF EXISTS "Members can join AGs" ON ag_memberships;
CREATE POLICY "Members can join AGs" ON ag_memberships
    FOR INSERT WITH CHECK (
        member_id IN (SELECT id FROM members WHERE user_id = auth.uid())
    );

-- Members can leave AGs (delete their own membership)
DROP POLICY IF EXISTS "Members can leave AGs" ON ag_memberships;
CREATE POLICY "Members can leave AGs" ON ag_memberships
    FOR DELETE USING (
        member_id IN (SELECT id FROM members WHERE user_id = auth.uid())
    );

-- AG admins/leads and system admins can update memberships (change roles)
DROP POLICY IF EXISTS "AG admins can update memberships" ON ag_memberships;
CREATE POLICY "AG admins can update memberships" ON ag_memberships
    FOR UPDATE USING (
        -- System admin
        EXISTS (
            SELECT 1 FROM members 
            WHERE user_id = auth.uid() AND app_role = 'admin'
        )
        OR
        -- AG admin/lead for this specific AG
        EXISTS (
            SELECT 1 FROM ag_memberships am
            INNER JOIN members m ON am.member_id = m.id
            WHERE m.user_id = auth.uid()
            AND am.working_group_id = ag_memberships.working_group_id
            AND am.role IN ('admin', 'lead')
        )
    );

-- 4. Create helper function to check if user is AG admin
CREATE OR REPLACE FUNCTION is_ag_admin(ag_id UUID)
RETURNS BOOLEAN AS $$
BEGIN
    RETURN EXISTS (
        SELECT 1 FROM ag_memberships am
        INNER JOIN members m ON am.member_id = m.id
        WHERE m.user_id = auth.uid()
        AND am.working_group_id = ag_id
        AND am.role IN ('admin', 'lead')
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 5. Create helper function to check permissions
CREATE OR REPLACE FUNCTION has_permission(permission_key TEXT)
RETURNS BOOLEAN AS $$
DECLARE
    member_record RECORD;
BEGIN
    SELECT * INTO member_record FROM members WHERE user_id = auth.uid();
    
    IF member_record IS NULL THEN
        RETURN FALSE;
    END IF;
    
    -- Admins and committee have all permissions
    IF member_record.app_role IN ('admin', 'committee') THEN
        RETURN TRUE;
    END IF;
    
    -- Check specific permission
    RETURN permission_key = ANY(member_record.permissions);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 6. Update calendar_events RLS to allow AG admins to manage their events
DROP POLICY IF EXISTS "AG admins can manage AG events" ON calendar_events;
CREATE POLICY "AG admins can manage AG events" ON calendar_events
    FOR ALL USING (
        -- System admin
        EXISTS (SELECT 1 FROM members WHERE user_id = auth.uid() AND app_role = 'admin')
        OR
        -- Committee
        EXISTS (SELECT 1 FROM members WHERE user_id = auth.uid() AND app_role = 'committee')
        OR
        -- AG admin for this event's AG
        (working_group_id IS NOT NULL AND is_ag_admin(working_group_id))
        OR
        -- Member with events:create permission (for general events only)
        (working_group_id IS NULL AND has_permission('events:create'))
    );

-- 7. Create view for easy permission checking
CREATE OR REPLACE VIEW member_permissions_view AS
SELECT 
    m.id as member_id,
    m.name,
    m.app_role,
    m.permissions,
    COALESCE(
        (SELECT array_agg(DISTINCT am.working_group_id) 
         FROM ag_memberships am 
         WHERE am.member_id = m.id AND am.role IN ('admin', 'lead')),
        '{}'::UUID[]
    ) as admin_of_ags
FROM members m;

-- Grant access to the view
GRANT SELECT ON member_permissions_view TO authenticated;

-- 8. Add some default permissions to existing committee/admin members
UPDATE members 
SET permissions = ARRAY['feed:create', 'feed:approve', 'wiki:edit', 'events:create', 'contacts:edit']
WHERE app_role IN ('admin', 'committee') AND (permissions IS NULL OR permissions = '{}');

COMMENT ON TABLE ag_memberships IS 'Tracks which members belong to which working groups, with roles (member, admin, lead)';
