-- ============================================================================
-- Guest Organizations for Events (Viral Loop Feature)
-- ============================================================================
-- Allow organizations to invite other organizations to their events.
-- This creates visibility and virality when guest orgs see how PulseDeck works.

-- Table to track guest organization invitations
CREATE TABLE IF NOT EXISTS event_guest_organizations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_id UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    host_organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    guest_organization_id UUID REFERENCES organizations(id) ON DELETE SET NULL,
    -- If guest org is not on PulseDeck yet, store their contact info:
    guest_org_name TEXT,
    guest_org_email TEXT,
    guest_org_contact_name TEXT,
    -- Invitation status
    status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'declined')),
    -- Audit
    invited_by UUID REFERENCES members(id) ON DELETE SET NULL,
    invited_at TIMESTAMPTZ DEFAULT now(),
    responded_at TIMESTAMPTZ,
    -- Prevent duplicate invitations
    UNIQUE(event_id, guest_organization_id),
    UNIQUE(event_id, guest_org_email)
);

-- Enable RLS
ALTER TABLE event_guest_organizations ENABLE ROW LEVEL SECURITY;

-- Drop existing policies if any
DROP POLICY IF EXISTS "Guest org invitations read" ON event_guest_organizations;
DROP POLICY IF EXISTS "Guest org invitations manage" ON event_guest_organizations;
DROP POLICY IF EXISTS "Guest org invitations public read" ON event_guest_organizations;

-- Policy: Members can read invitations for their org's events
CREATE POLICY "Guest org invitations read" ON event_guest_organizations
FOR SELECT USING (
    -- User is member of host org
    EXISTS (
        SELECT 1 FROM members m
        WHERE m.user_id = auth.uid()
        AND m.organization_id = host_organization_id
    )
    -- OR user is member of invited org (if on PulseDeck)
    OR (
        guest_organization_id IS NOT NULL
        AND EXISTS (
            SELECT 1 FROM members m
            WHERE m.user_id = auth.uid()
            AND m.organization_id = guest_organization_id
        )
    )
);

-- Policy: Admins/Committee of host org can manage invitations
CREATE POLICY "Guest org invitations manage" ON event_guest_organizations
FOR ALL USING (
    EXISTS (
        SELECT 1 FROM members m
        WHERE m.user_id = auth.uid()
        AND m.organization_id = host_organization_id
        AND m.app_role IN ('admin', 'committee')
    )
);

-- Policy: Public can read accepted invitations for public events
CREATE POLICY "Guest org invitations public read" ON event_guest_organizations
FOR SELECT USING (
    status = 'accepted'
    AND EXISTS (
        SELECT 1 FROM events e
        WHERE e.id = event_id
        AND 'public' = ANY(e.allowed_roles)
    )
);

-- Index for performance
CREATE INDEX IF NOT EXISTS idx_event_guest_orgs_event ON event_guest_organizations(event_id);
CREATE INDEX IF NOT EXISTS idx_event_guest_orgs_host ON event_guest_organizations(host_organization_id);
CREATE INDEX IF NOT EXISTS idx_event_guest_orgs_guest ON event_guest_organizations(guest_organization_id);

-- ============================================================================
-- Add branding_enabled flag to organizations (for future premium features)
-- ============================================================================
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name='organizations' AND column_name='branding_enabled'
    ) THEN
        ALTER TABLE organizations 
        ADD COLUMN branding_enabled BOOLEAN DEFAULT true;
        COMMENT ON COLUMN organizations.branding_enabled IS 
            'If true, show "Powered by PulseDeck" on public pages. Free tier always shows it.';
    END IF;
END $$;

-- ============================================================================
-- Function to count guest organizations for an event
-- ============================================================================
CREATE OR REPLACE FUNCTION get_event_guest_count(p_event_id UUID)
RETURNS INTEGER AS $$
BEGIN
    RETURN (
        SELECT COUNT(*) 
        FROM event_guest_organizations 
        WHERE event_id = p_event_id 
        AND status = 'accepted'
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
