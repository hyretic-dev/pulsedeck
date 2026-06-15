-- ============================================================================
-- SKILL-TAGGING SYSTEM
-- Enables members to tag their skills, interests, and availability
-- Allows admins to filter and target members for specific tasks
-- ============================================================================

-- Skills table: predefined skills per organization
CREATE TABLE IF NOT EXISTS skills (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    category TEXT NOT NULL DEFAULT 'ability', -- 'ability', 'interest', 'availability'
    icon TEXT, -- PrimeIcons name, e.g., 'pi-car', 'pi-pencil'
    description TEXT,
    sort_order INTEGER DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now(),
    
    -- Each skill name must be unique within an org
    UNIQUE(organization_id, name)
);

-- Member-Skill junction table
CREATE TABLE IF NOT EXISTS member_skills (
    member_id UUID NOT NULL REFERENCES members(id) ON DELETE CASCADE,
    skill_id UUID NOT NULL REFERENCES skills(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ DEFAULT now(),
    
    PRIMARY KEY (member_id, skill_id)
);

-- Indexes for efficient querying
CREATE INDEX IF NOT EXISTS idx_skills_org ON skills(organization_id);
CREATE INDEX IF NOT EXISTS idx_skills_category ON skills(organization_id, category);
CREATE INDEX IF NOT EXISTS idx_member_skills_member ON member_skills(member_id);
CREATE INDEX IF NOT EXISTS idx_member_skills_skill ON member_skills(skill_id);

-- ============================================================================
-- ROW LEVEL SECURITY
-- ============================================================================

ALTER TABLE skills ENABLE ROW LEVEL SECURITY;
ALTER TABLE member_skills ENABLE ROW LEVEL SECURITY;

-- Skills: Anyone in the org can view, only admins can modify
CREATE POLICY "Users can view skills in their organization"
    ON skills FOR SELECT
    TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM members 
            WHERE members.user_id = auth.uid() 
            AND members.organization_id = skills.organization_id
        )
    );

CREATE POLICY "Admins can manage skills"
    ON skills FOR ALL
    TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM members 
            WHERE members.user_id = auth.uid() 
            AND members.organization_id = skills.organization_id
            AND members.app_role = 'admin'
        )
    )
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM members 
            WHERE members.user_id = auth.uid() 
            AND members.organization_id = skills.organization_id
            AND members.app_role = 'admin'
        )
    );

-- Member Skills: Users can view in their org, edit only their own
CREATE POLICY "Users can view member skills in their organization"
    ON member_skills FOR SELECT
    TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM members m
            JOIN skills s ON s.id = member_skills.skill_id
            WHERE m.user_id = auth.uid() 
            AND m.organization_id = s.organization_id
        )
    );

CREATE POLICY "Users can manage their own skills"
    ON member_skills FOR ALL
    TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM members 
            WHERE members.id = member_skills.member_id 
            AND members.user_id = auth.uid()
        )
    )
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM members 
            WHERE members.id = member_skills.member_id 
            AND members.user_id = auth.uid()
        )
    );

CREATE POLICY "Admins can manage all member skills"
    ON member_skills FOR ALL
    TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM members m
            JOIN skills s ON s.id = member_skills.skill_id
            WHERE m.user_id = auth.uid() 
            AND m.organization_id = s.organization_id
            AND m.app_role = 'admin'
        )
    )
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM members m
            JOIN skills s ON s.id = member_skills.skill_id
            WHERE m.user_id = auth.uid() 
            AND m.organization_id = s.organization_id
            AND m.app_role = 'admin'
        )
    );

-- ============================================================================
-- HELPER FUNCTIONS
-- ============================================================================

-- Get all skills for a member with skill details
CREATE OR REPLACE FUNCTION get_member_skills(member_uuid UUID)
RETURNS TABLE (
    skill_id UUID,
    skill_name TEXT,
    skill_category TEXT,
    skill_icon TEXT
) 
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
    SELECT s.id, s.name, s.category, s.icon
    FROM member_skills ms
    JOIN skills s ON s.id = ms.skill_id
    WHERE ms.member_id = member_uuid
    ORDER BY s.category, s.sort_order, s.name;
$$;

-- Get members with specific skills (for admin filtering)
CREATE OR REPLACE FUNCTION get_members_by_skills(
    org_uuid UUID,
    skill_ids UUID[]
)
RETURNS TABLE (
    member_id UUID,
    member_name TEXT,
    member_email TEXT,
    matching_skills INTEGER
) 
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
    SELECT 
        m.id,
        m.name,
        m.email,
        COUNT(ms.skill_id)::INTEGER as matching_skills
    FROM members m
    JOIN member_skills ms ON ms.member_id = m.id
    WHERE m.organization_id = org_uuid
    AND ms.skill_id = ANY(skill_ids)
    GROUP BY m.id, m.name, m.email
    ORDER BY matching_skills DESC, m.name;
$$;

-- ============================================================================
-- SEED DEFAULT SKILLS (for new organizations)
-- ============================================================================

-- Function to create default skills for a new organization
CREATE OR REPLACE FUNCTION create_default_skills(org_uuid UUID)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
    INSERT INTO skills (organization_id, name, category, icon, sort_order) VALUES
    -- Fähigkeiten (Abilities)
    (org_uuid, 'Führerschein Klasse B', 'ability', 'pi-car', 1),
    (org_uuid, 'Führerschein mit Anhänger', 'ability', 'pi-car', 2),
    (org_uuid, 'Texte schreiben', 'ability', 'pi-pencil', 3),
    (org_uuid, 'Social Media', 'ability', 'pi-share-alt', 4),
    (org_uuid, 'Grafik/Design', 'ability', 'pi-palette', 5),
    (org_uuid, 'Fotografie', 'ability', 'pi-camera', 6),
    (org_uuid, 'Erste Hilfe', 'ability', 'pi-heart', 7),
    (org_uuid, 'Moderation', 'ability', 'pi-microphone', 8),
    (org_uuid, 'Kochen/Catering', 'ability', 'pi-utensils', 9),
    (org_uuid, 'Handwerklich geschickt', 'ability', 'pi-wrench', 10),
    
    -- Interessen (Interests)
    (org_uuid, 'Sozialpolitik', 'interest', 'pi-users', 20),
    (org_uuid, 'Umwelt & Klima', 'interest', 'pi-globe', 21),
    (org_uuid, 'Wirtschaftspolitik', 'interest', 'pi-chart-line', 22),
    (org_uuid, 'Bildungspolitik', 'interest', 'pi-book', 23),
    (org_uuid, 'Kommunalpolitik', 'interest', 'pi-building', 24),
    (org_uuid, 'Öffentlichkeitsarbeit', 'interest', 'pi-megaphone', 25),
    (org_uuid, 'Veranstaltungen', 'interest', 'pi-calendar', 26),
    
    -- Verfügbarkeit (Availability)
    (org_uuid, 'Wochenende verfügbar', 'availability', 'pi-clock', 40),
    (org_uuid, 'Abends verfügbar', 'availability', 'pi-moon', 41),
    (org_uuid, 'Spontan einsetzbar', 'availability', 'pi-bolt', 42),
    (org_uuid, 'Mit PKW mobil', 'availability', 'pi-car', 43)
    
    ON CONFLICT (organization_id, name) DO NOTHING;
END;
$$;

-- Trigger to create default skills when a new organization is created
CREATE OR REPLACE FUNCTION on_organization_created()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    PERFORM create_default_skills(NEW.id);
    RETURN NEW;
END;
$$;

-- Only create trigger if it doesn't exist
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_trigger WHERE tgname = 'trigger_create_default_skills'
    ) THEN
        CREATE TRIGGER trigger_create_default_skills
            AFTER INSERT ON organizations
            FOR EACH ROW
            EXECUTE FUNCTION on_organization_created();
    END IF;
END;
$$;

-- ============================================================================
-- SEED DEFAULT SKILLS FOR EXISTING ORGANIZATIONS
-- ============================================================================

-- Create default skills for all existing organizations that don't have any
DO $$
DECLARE
    org RECORD;
BEGIN
    FOR org IN 
        SELECT id FROM organizations 
        WHERE NOT EXISTS (
            SELECT 1 FROM skills WHERE skills.organization_id = organizations.id
        )
    LOOP
        PERFORM create_default_skills(org.id);
    END LOOP;
END;
$$;
