ALTER TABLE wiki_docs 
ADD COLUMN IF NOT EXISTS working_group_id UUID REFERENCES working_groups(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_wiki_docs_working_group ON wiki_docs(working_group_id);

-- Recreate Policies to support AG Visibility

DROP POLICY IF EXISTS "Wiki: View" ON wiki_docs;
DROP POLICY IF EXISTS "Wiki: Insert" ON wiki_docs;
DROP POLICY IF EXISTS "Wiki: Update" ON wiki_docs;
DROP POLICY IF EXISTS "Wiki: Delete" ON wiki_docs;

CREATE POLICY "Wiki: View" ON wiki_docs FOR SELECT USING (
    -- 1. System Admins / Committee see everything in their Org
    (EXISTS (
        SELECT 1 FROM members 
        WHERE user_id = auth.uid() 
        AND organization_id = wiki_docs.organization_id 
        AND app_role IN ('admin', 'committee')
    ))
    OR
    -- 2. AG Articles
    (
        working_group_id IS NOT NULL 
        AND 
        (
             -- Basic check: Must be AG Member to see anything (even Published)
             EXISTS (
                 SELECT 1 FROM ag_memberships 
                 WHERE member_id = (SELECT id FROM members WHERE user_id = auth.uid() AND organization_id = wiki_docs.organization_id)
                 AND working_group_id = wiki_docs.working_group_id
             )
        )
        AND 
        (
            -- Status Check inside AG:
            -- Published -> Visible to all members
            status = 'Published'
            OR
            -- Draft/Review -> Visible only to AG Lead/Admin
            (EXISTS (
                 SELECT 1 FROM ag_memberships 
                 WHERE member_id = (SELECT id FROM members WHERE user_id = auth.uid() AND organization_id = wiki_docs.organization_id)
                 AND working_group_id = wiki_docs.working_group_id
                 AND role IN ('lead', 'admin')
            ))
        )
    )
    OR
    -- 3. Global Articles (working_group_id IS NULL)
    (
        working_group_id IS NULL 
        AND
        status = 'Published' 
        AND 
        (EXISTS (
             SELECT 1 FROM members 
             WHERE user_id = auth.uid() 
             AND organization_id = wiki_docs.organization_id 
             AND (
                 'public' = ANY(wiki_docs.allowed_roles) OR
                 members.app_role::text = ANY(wiki_docs.allowed_roles)
             )
        ))
    )
);

CREATE POLICY "Wiki: Insert" ON wiki_docs FOR INSERT WITH CHECK (
    auth.role() = 'authenticated' AND
    organization_id IS NOT NULL AND
    (
        -- Global: Member can insert
        (working_group_id IS NULL AND EXISTS (
            SELECT 1 FROM members WHERE user_id = auth.uid() AND organization_id = wiki_docs.organization_id
        ))
        OR
        -- AG: Must be AG Member
        (working_group_id IS NOT NULL AND EXISTS (
            SELECT 1 FROM ag_memberships 
             WHERE member_id = (SELECT id FROM members WHERE user_id = auth.uid() AND organization_id = wiki_docs.organization_id)
             AND working_group_id = wiki_docs.working_group_id
        ))
    )
);

CREATE POLICY "Wiki: Update" ON wiki_docs FOR UPDATE USING (
    auth.role() = 'authenticated' AND
    (
        -- Global: Member can update
        (working_group_id IS NULL AND EXISTS (
            SELECT 1 FROM members WHERE user_id = auth.uid() AND organization_id = wiki_docs.organization_id
        ))
        OR
        -- AG: AG Member can update
        (working_group_id IS NOT NULL AND EXISTS (
            SELECT 1 FROM ag_memberships 
             WHERE member_id = (SELECT id FROM members WHERE user_id = auth.uid() AND organization_id = wiki_docs.organization_id)
             AND working_group_id = wiki_docs.working_group_id
        ))
    )
);

CREATE POLICY "Wiki: Delete" ON wiki_docs FOR DELETE USING (
     -- System Admin/Committee
    (EXISTS (
        SELECT 1 FROM members 
        WHERE user_id = auth.uid() 
        AND organization_id = wiki_docs.organization_id 
        AND app_role IN ('admin', 'committee')
    ))
    OR
    -- AG Lead
    (working_group_id IS NOT NULL AND EXISTS (
         SELECT 1 FROM ag_memberships 
         WHERE member_id = (SELECT id FROM members WHERE user_id = auth.uid() AND organization_id = wiki_docs.organization_id)
         AND working_group_id = wiki_docs.working_group_id
         AND role IN ('lead', 'admin')
    ))
);
