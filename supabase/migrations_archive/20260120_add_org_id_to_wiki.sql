-- Fix Missing organization_id in wiki_docs
-- This is critical for Multi-Tenancy and fixing the HTTP 400 Error

-- 1. Add Column
ALTER TABLE wiki_docs 
ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE;

-- 2. Index for Performance
CREATE INDEX IF NOT EXISTS idx_wiki_docs_organization ON wiki_docs(organization_id);

-- 3. (Optional) If we had a default org, we would update here.
-- UPDATE wiki_docs SET organization_id = '...' WHERE organization_id IS NULL;
