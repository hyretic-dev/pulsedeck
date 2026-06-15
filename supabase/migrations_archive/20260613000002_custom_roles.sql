-- ═══════════════════════════════════════════════════════════════════════════
-- RBAC: CUSTOM ORGANIZATION ROLES
-- ═══════════════════════════════════════════════════════════════════════════

-- 1. Create table for custom roles
CREATE TABLE IF NOT EXISTS organization_roles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    description TEXT,
    permissions TEXT[] DEFAULT '{}',
    is_system_admin BOOLEAN DEFAULT false,
    is_default BOOLEAN DEFAULT false,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now(),
    UNIQUE(organization_id, name)
);

ALTER TABLE organization_roles ENABLE ROW LEVEL SECURITY;

-- 2. Add role_id to members (Must happen BEFORE RLS policy referencing it)
ALTER TABLE members ADD COLUMN IF NOT EXISTS role_id UUID REFERENCES organization_roles(id) ON DELETE RESTRICT;

-- RLS for roles: Viewable by anyone in the organization
DROP POLICY IF EXISTS "Roles viewable by org members" ON organization_roles;
CREATE POLICY "Roles viewable by org members" ON organization_roles
    FOR SELECT USING (
        organization_id IN (
            SELECT organization_id FROM get_user_memberships(auth.uid())
        )
    );

-- Only system admins (owner or is_system_admin) can manage roles
DROP POLICY IF EXISTS "Roles manageable by org admins" ON organization_roles;
CREATE POLICY "Roles manageable by org admins" ON organization_roles
    FOR ALL USING (
        organization_id IN (
            SELECT id FROM organizations WHERE owner_id = auth.uid()
        )
        OR 
        EXISTS (
            SELECT 1 FROM get_user_memberships(auth.uid()) m 
            WHERE m.organization_id = organization_roles.organization_id
            AND m.app_role = 'admin'
        )
    );



-- 3. Data Migration for existing records
DO $$
DECLARE
    org RECORD;
    admin_role_id UUID;
    committee_role_id UUID;
    member_role_id UUID;
    public_role_id UUID;
BEGIN
    FOR org IN SELECT id FROM organizations LOOP
        -- Skip if roles already exist for this org (safety check)
        IF EXISTS (SELECT 1 FROM organization_roles WHERE organization_id = org.id) THEN
            CONTINUE;
        END IF;

        -- Create Admin role
        INSERT INTO organization_roles (organization_id, name, description, is_system_admin, is_default, permissions)
        VALUES (org.id, 'Admin', 'Systemadministrator mit vollen Rechten', true, false, ARRAY['feed:create', 'feed:approve', 'wiki:edit', 'events:create', 'contacts:edit', 'view_issue_tracker'])
        RETURNING id INTO admin_role_id;

        -- Create Vorstand role
        INSERT INTO organization_roles (organization_id, name, description, is_system_admin, is_default, permissions)
        VALUES (org.id, 'Vorstand', 'Erweiterte Rechte für den Vorstand', false, false, ARRAY['feed:create', 'feed:approve', 'wiki:edit', 'events:create', 'contacts:edit', 'view_issue_tracker'])
        RETURNING id INTO committee_role_id;

        -- Create Mitglied role
        INSERT INTO organization_roles (organization_id, name, description, is_system_admin, is_default, permissions)
        VALUES (org.id, 'Mitglied', 'Standardmitglied', false, true, ARRAY['feed:create'])
        RETURNING id INTO member_role_id;
        
        -- Create Public role
        INSERT INTO organization_roles (organization_id, name, description, is_system_admin, is_default, permissions)
        VALUES (org.id, 'Gast', 'Eingeschränkte Rechte', false, false, ARRAY[]::TEXT[])
        RETURNING id INTO public_role_id;

        -- Update existing members in this org
        UPDATE members SET role_id = admin_role_id WHERE organization_id = org.id AND app_role = 'admin';
        UPDATE members SET role_id = committee_role_id WHERE organization_id = org.id AND app_role = 'committee';
        UPDATE members SET role_id = member_role_id WHERE organization_id = org.id AND app_role = 'member';
        UPDATE members SET role_id = public_role_id WHERE organization_id = org.id AND app_role = 'public';
        -- Fallback for any other/null app_role
        UPDATE members SET role_id = member_role_id WHERE organization_id = org.id AND role_id IS NULL;
    END LOOP;
END $$;

-- 4. Make role_id NOT NULL
-- Old columns app_role and permissions will be dropped in a future migration
-- to prevent breaking the live app during rollout.
ALTER TABLE members ALTER COLUMN role_id SET NOT NULL;

-- 5. Trigger for new organizations
CREATE OR REPLACE FUNCTION trg_create_default_org_roles()
RETURNS TRIGGER AS $$
BEGIN
    INSERT INTO organization_roles (organization_id, name, description, is_system_admin, is_default, permissions)
    VALUES (NEW.id, 'Admin', 'Systemadministrator', true, false, ARRAY['feed:create', 'feed:approve', 'wiki:edit', 'events:create', 'contacts:edit', 'view_issue_tracker']);
    
    INSERT INTO organization_roles (organization_id, name, description, is_system_admin, is_default, permissions)
    VALUES (NEW.id, 'Mitglied', 'Standardmitglied', false, true, ARRAY['feed:create']);
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_organization_created ON organizations;
CREATE TRIGGER on_organization_created
    AFTER INSERT ON organizations
    FOR EACH ROW EXECUTE FUNCTION trg_create_default_org_roles();

-- 6. Trigger to protect owner
CREATE OR REPLACE FUNCTION trg_protect_org_owner()
RETURNS TRIGGER AS $$
DECLARE
    is_owner BOOLEAN;
    is_admin_role BOOLEAN;
BEGIN
    SELECT (owner_id = OLD.user_id) INTO is_owner FROM organizations WHERE id = OLD.organization_id;
    
    IF is_owner THEN
        IF TG_OP = 'DELETE' THEN
            RAISE EXCEPTION 'Der Besitzer kann die Organisation nicht verlassen. Bitte übertrage zuerst den Besitz.';
        END IF;
        
        IF TG_OP = 'UPDATE' THEN
            IF NEW.role_id != OLD.role_id THEN
                SELECT is_system_admin INTO is_admin_role FROM organization_roles WHERE id = NEW.role_id;
                IF NOT is_admin_role THEN
                    RAISE EXCEPTION 'Dem Besitzer kann die Admin-Rolle nicht entzogen werden.';
                END IF;
            END IF;
        END IF;
    END IF;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS protect_org_owner_member ON members;
CREATE TRIGGER protect_org_owner_member
    BEFORE UPDATE OR DELETE ON members
    FOR EACH ROW EXECUTE FUNCTION trg_protect_org_owner();

-- 7. Fix has_permission (Mandanten-aware)
CREATE OR REPLACE FUNCTION has_permission(permission_key TEXT, org_id UUID)
RETURNS BOOLEAN AS $$
DECLARE
    role_record RECORD;
BEGIN
    SELECT r.* INTO role_record 
    FROM members m
    INNER JOIN organization_roles r ON m.role_id = r.id
    WHERE m.user_id = auth.uid() AND m.organization_id = org_id;
    
    IF role_record IS NULL THEN
        RETURN FALSE;
    END IF;
    
    IF role_record.is_system_admin THEN
        RETURN TRUE;
    END IF;
    
    RETURN permission_key = ANY(COALESCE(role_record.permissions, '{}'));
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
