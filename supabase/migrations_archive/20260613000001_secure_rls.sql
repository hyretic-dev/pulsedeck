-- ═══════════════════════════════════════════════════════════════════════════
-- RLS SECURITY FIXES (CWE-284, CWE-200)
-- ═══════════════════════════════════════════════════════════════════════════

-- 1. MEMBERS TABELLE ABSICHERN
DROP POLICY IF EXISTS "Public can check member emails" ON members;
DROP POLICY IF EXISTS "Members can view other members in their orgs" ON members;

CREATE POLICY "Members can view other members in their orgs" ON members
    FOR SELECT USING (
        organization_id IN (
            SELECT organization_id FROM get_user_memberships(auth.uid())
        )
    );

-- 2. WORKING GROUPS TABELLE ABSICHERN
DROP POLICY IF EXISTS "Public can read working groups" ON working_groups;
DROP POLICY IF EXISTS "Members can view working groups in their orgs" ON working_groups;

CREATE POLICY "Members can view working groups in their orgs" ON working_groups
    FOR SELECT USING (
        organization_id IN (
            SELECT organization_id FROM get_user_memberships(auth.uid())
        )
    );

-- 3. EVENTS / CALENDAR_EVENTS TABELLE ABSICHERN
DO $$ 
BEGIN
    -- Prüfe auf events Tabelle
    IF EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'events') THEN
        DROP POLICY IF EXISTS "Public events are viewable by everyone" ON events;
        DROP POLICY IF EXISTS "Events are viewable by members or if public" ON events;
        CREATE POLICY "Events are viewable by members or if public" ON events
            FOR SELECT USING (
                organization_id IN (SELECT organization_id FROM get_user_memberships(auth.uid()))
                OR 'public' = ANY(allowed_roles)
            );
    END IF;
    
    -- Prüfe auf calendar_events Tabelle
    IF EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'calendar_events') THEN
        DROP POLICY IF EXISTS "Public events are viewable by everyone" ON calendar_events;
        DROP POLICY IF EXISTS "Events are viewable by members or if public" ON calendar_events;
        CREATE POLICY "Events are viewable by members or if public" ON calendar_events
            FOR SELECT USING (
                organization_id IN (SELECT organization_id FROM get_user_memberships(auth.uid()))
                OR 'public' = ANY(allowed_roles)
            );
    END IF;
END $$;

-- 4. ORGANIZATIONS TABELLE (Bleibt absichtlich public für Landing-Pages)
-- Wird hier nur zur Vollständigkeit der Dokumentation erwähnt.
