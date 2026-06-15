-- Fix Wiki Multi-Tenancy
ALTER TABLE wiki_docs 
ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE;

-- Auto-migrate existing docs to the first organization found
UPDATE wiki_docs 
SET organization_id = (SELECT id FROM organizations ORDER BY created_at ASC LIMIT 1) 
WHERE organization_id IS NULL;

-- ========= WIKI RLS =========

DROP POLICY IF EXISTS "Allow public read access on wiki_docs" ON wiki_docs;
DROP POLICY IF EXISTS "Allow public insert on wiki_docs" ON wiki_docs;
DROP POLICY IF EXISTS "Allow public update on wiki_docs" ON wiki_docs;
DROP POLICY IF EXISTS "Allow public delete on wiki_docs" ON wiki_docs;
DROP POLICY IF EXISTS "Wiki Visibility" ON wiki_docs;
DROP POLICY IF EXISTS "Wiki Manage" ON wiki_docs;

ALTER TABLE wiki_docs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Wiki: View" ON wiki_docs FOR SELECT USING (
    -- Admin or Committee sees everything in their org
    (EXISTS (
        SELECT 1 FROM members 
        WHERE user_id = auth.uid() 
        AND organization_id = wiki_docs.organization_id 
        AND app_role IN ('admin', 'committee')
    ))
    OR
    -- Regular members see Published docs where they have role access
    (
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
    (EXISTS (
        SELECT 1 FROM members 
        WHERE user_id = auth.uid() 
        AND organization_id = wiki_docs.organization_id
    ))
);

CREATE POLICY "Wiki: Update" ON wiki_docs FOR UPDATE USING (
    auth.role() = 'authenticated' AND
    (EXISTS (
        SELECT 1 FROM members 
        WHERE user_id = auth.uid() 
        AND organization_id = wiki_docs.organization_id
    ))
);

CREATE POLICY "Wiki: Delete" ON wiki_docs FOR DELETE USING (
    (EXISTS (
        SELECT 1 FROM members 
        WHERE user_id = auth.uid() 
        AND organization_id = wiki_docs.organization_id 
        AND app_role IN ('admin', 'committee')
    ))
);


-- ========= FEED RLS =========

DROP POLICY IF EXISTS "View approved items" ON feed_items;
DROP POLICY IF EXISTS "Authors manage own items" ON feed_items;
DROP POLICY IF EXISTS "Admins manage all" ON feed_items;
DROP POLICY IF EXISTS "Members can view feed_items in their org" ON feed_items;
DROP POLICY IF EXISTS "Members can create feed_items in their org" ON feed_items;
DROP POLICY IF EXISTS "Admins can manage feed_items" ON feed_items;

ALTER TABLE feed_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Feed: View" ON feed_items FOR SELECT USING (
    -- Admin/Committee sees everything
    (EXISTS (
        SELECT 1 FROM members 
        WHERE user_id = auth.uid() 
        AND organization_id = feed_items.organization_id 
        AND app_role IN ('admin', 'committee')
    ))
    OR
    -- Author sees their own items (even drafts)
    (feed_items.author_id = (SELECT id FROM members WHERE user_id = auth.uid() AND organization_id = feed_items.organization_id LIMIT 1))
    OR
    -- Members see Approved/Sent items
    (
        status IN ('approved', 'sent')
        AND
        (EXISTS (
            SELECT 1 FROM members 
            WHERE user_id = auth.uid() 
            AND organization_id = feed_items.organization_id
        ))
    )
);

CREATE POLICY "Feed: Insert" ON feed_items FOR INSERT WITH CHECK (
    EXISTS (
        SELECT 1 FROM members 
        WHERE user_id = auth.uid() 
        AND organization_id = feed_items.organization_id
        AND (
            app_role IN ('admin', 'committee') OR
            'feed:create' = ANY(permissions)
        )
    )
);

CREATE POLICY "Feed: Update" ON feed_items FOR UPDATE USING (
    (EXISTS (
        SELECT 1 FROM members 
        WHERE user_id = auth.uid() 
        AND organization_id = feed_items.organization_id 
        AND app_role IN ('admin', 'committee')
    ))
    OR
    (feed_items.author_id = (SELECT id FROM members WHERE user_id = auth.uid() AND organization_id = feed_items.organization_id LIMIT 1))
);

CREATE POLICY "Feed: Delete" ON feed_items FOR DELETE USING (
    (EXISTS (
        SELECT 1 FROM members 
        WHERE user_id = auth.uid() 
        AND organization_id = feed_items.organization_id 
        AND app_role IN ('admin', 'committee')
    ))
    OR
    (feed_items.author_id = (SELECT id FROM members WHERE user_id = auth.uid() AND organization_id = feed_items.organization_id LIMIT 1))
);
