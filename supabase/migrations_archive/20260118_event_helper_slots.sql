-- ============================================================================
-- EVENT HELPER SLOTS - Schichtplan für Events
-- Migration: 20260118_event_helper_slots.sql
-- ============================================================================

-- 1. Event Slots table (Schichten pro Event)
-- ============================================================================
CREATE TABLE IF NOT EXISTS event_slots (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_id UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    description TEXT,
    start_time TIME,
    end_time TIME,
    max_helpers INTEGER DEFAULT 5,
    required_skills UUID[] DEFAULT '{}', -- Array of skill IDs
    sort_order INTEGER DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- Index for faster queries
CREATE INDEX IF NOT EXISTS idx_event_slots_event_id ON event_slots(event_id);
CREATE INDEX IF NOT EXISTS idx_event_slots_organization_id ON event_slots(organization_id);

-- 2. Slot Signups table (Helfer-Anmeldungen)
-- ============================================================================
CREATE TABLE IF NOT EXISTS event_slot_signups (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    slot_id UUID NOT NULL REFERENCES event_slots(id) ON DELETE CASCADE,
    member_id UUID NOT NULL REFERENCES members(id) ON DELETE CASCADE,
    status TEXT DEFAULT 'confirmed' CHECK (status IN ('confirmed', 'cancelled', 'pending')),
    note TEXT, -- Optional note from the helper
    signed_up_at TIMESTAMPTZ DEFAULT now(),
    
    -- A member can only sign up once per slot
    UNIQUE(slot_id, member_id)
);

-- Index for faster queries
CREATE INDEX IF NOT EXISTS idx_event_slot_signups_slot_id ON event_slot_signups(slot_id);
CREATE INDEX IF NOT EXISTS idx_event_slot_signups_member_id ON event_slot_signups(member_id);

-- ============================================================================
-- ROW LEVEL SECURITY
-- ============================================================================

ALTER TABLE event_slots ENABLE ROW LEVEL SECURITY;
ALTER TABLE event_slot_signups ENABLE ROW LEVEL SECURITY;

-- Event Slots Policies
-- ============================================================================

-- Users can view slots for events in their organization
CREATE POLICY "Users can view event slots in their org"
    ON event_slots FOR SELECT
    TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM members 
            WHERE members.user_id = auth.uid() 
            AND members.organization_id = event_slots.organization_id
        )
    );

-- Admins can manage slots
CREATE POLICY "Admins can insert event slots"
    ON event_slots FOR INSERT
    TO authenticated
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM members 
            WHERE members.user_id = auth.uid() 
            AND members.organization_id = event_slots.organization_id
            AND members.app_role = 'admin'
        )
    );

CREATE POLICY "Admins can update event slots"
    ON event_slots FOR UPDATE
    TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM members 
            WHERE members.user_id = auth.uid() 
            AND members.organization_id = event_slots.organization_id
            AND members.app_role = 'admin'
        )
    );

CREATE POLICY "Admins can delete event slots"
    ON event_slots FOR DELETE
    TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM members 
            WHERE members.user_id = auth.uid() 
            AND members.organization_id = event_slots.organization_id
            AND members.app_role = 'admin'
        )
    );

-- Slot Signups Policies
-- ============================================================================

-- Users can view signups for slots in their org
CREATE POLICY "Users can view slot signups in their org"
    ON event_slot_signups FOR SELECT
    TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM event_slots es
            JOIN members m ON m.organization_id = es.organization_id
            WHERE es.id = event_slot_signups.slot_id
            AND m.user_id = auth.uid()
        )
    );

-- Members can sign up for slots
CREATE POLICY "Members can sign up for slots"
    ON event_slot_signups FOR INSERT
    TO authenticated
    WITH CHECK (
        -- The member must belong to the same org as the slot
        EXISTS (
            SELECT 1 FROM event_slots es
            JOIN members m ON m.organization_id = es.organization_id
            WHERE es.id = event_slot_signups.slot_id
            AND m.user_id = auth.uid()
            AND m.id = event_slot_signups.member_id
        )
    );

-- Members can update their own signups (e.g., cancel)
CREATE POLICY "Members can update own signups"
    ON event_slot_signups FOR UPDATE
    TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM members 
            WHERE members.id = event_slot_signups.member_id
            AND members.user_id = auth.uid()
        )
    );

-- Members can delete their own signups
CREATE POLICY "Members can delete own signups"
    ON event_slot_signups FOR DELETE
    TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM members 
            WHERE members.id = event_slot_signups.member_id
            AND members.user_id = auth.uid()
        )
    );

-- Admins can manage all signups
CREATE POLICY "Admins can manage all signups"
    ON event_slot_signups FOR ALL
    TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM event_slots es
            JOIN members m ON m.organization_id = es.organization_id
            WHERE es.id = event_slot_signups.slot_id
            AND m.user_id = auth.uid()
            AND m.app_role = 'admin'
        )
    );

-- ============================================================================
-- HELPER FUNCTIONS
-- ============================================================================

-- Get current signup count for a slot
CREATE OR REPLACE FUNCTION get_slot_signup_count(p_slot_id UUID)
RETURNS INTEGER
LANGUAGE SQL
STABLE
AS $$
    SELECT COUNT(*)::INTEGER
    FROM event_slot_signups
    WHERE slot_id = p_slot_id
    AND status = 'confirmed';
$$;

-- Check if slot has capacity
CREATE OR REPLACE FUNCTION has_slot_capacity(p_slot_id UUID)
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
AS $$
    SELECT 
        COALESCE(
            (SELECT COUNT(*) FROM event_slot_signups WHERE slot_id = p_slot_id AND status = 'confirmed')
            < (SELECT max_helpers FROM event_slots WHERE id = p_slot_id),
            true
        );
$$;

-- ============================================================================
-- COMMENT
-- ============================================================================
COMMENT ON TABLE event_slots IS 'Helfer-Slots (Schichten) für Events';
COMMENT ON TABLE event_slot_signups IS 'Anmeldungen von Mitgliedern für Event-Slots';
