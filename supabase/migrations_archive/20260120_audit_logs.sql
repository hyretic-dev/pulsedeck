-- Create Audit Logs System
-- Tracks all major activities across organizations
-- Only visible to specific Super Admin (Julien)

CREATE TABLE IF NOT EXISTS audit_logs (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    created_at TIMESTAMPTZ DEFAULT now(),
    table_name TEXT NOT NULL,
    operation TEXT NOT NULL, -- INSERT, UPDATE, DELETE
    record_id UUID,
    old_data JSONB,
    new_data JSONB,
    performed_by UUID DEFAULT auth.uid(), -- user_id
    organization_id UUID -- Captured from data if present
);

-- Index for speed
CREATE INDEX idx_audit_logs_created_at ON audit_logs(created_at DESC);
CREATE INDEX idx_audit_logs_table ON audit_logs(table_name);
CREATE INDEX idx_audit_logs_org ON audit_logs(organization_id);

-- RLS: Only Super Admin can view
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Super Admin View" ON audit_logs 
FOR SELECT 
USING (auth.uid() = '2d8af6a7-507c-4834-aff9-3b00d1ad9c7c'::uuid);

-- Trigger Function
CREATE OR REPLACE FUNCTION log_audit_event() RETURNS TRIGGER AS $$
DECLARE
    rec_id UUID;
    old_json JSONB;
    new_json JSONB;
    op TEXT;
    org_id UUID;
    usr_id UUID;
BEGIN
    op := TG_OP;
    usr_id := auth.uid();
    
    -- Extract ID and Organization Info
    IF op = 'DELETE' THEN
        rec_id := OLD.id;
        old_json := to_jsonb(OLD);
        IF (old_json ? 'organization_id') THEN
            org_id := (old_json->>'organization_id')::uuid;
        END IF;
    ELSIF op = 'UPDATE' THEN
        rec_id := NEW.id;
        old_json := to_jsonb(OLD);
        new_json := to_jsonb(NEW);
        IF (new_json ? 'organization_id') THEN
            org_id := (new_json->>'organization_id')::uuid;
        END IF;
    ELSIF op = 'INSERT' THEN
        rec_id := NEW.id;
        new_json := to_jsonb(NEW);
        IF (new_json ? 'organization_id') THEN
            org_id := (new_json->>'organization_id')::uuid;
        END IF;
    END IF;

    -- Insert Log
    INSERT INTO audit_logs (
        table_name, 
        operation, 
        record_id, 
        old_data, 
        new_data, 
        performed_by, 
        organization_id
    )
    VALUES (
        TG_TABLE_NAME, 
        op, 
        rec_id, 
        old_json, 
        new_json, 
        usr_id, 
        org_id
    );
    
    RETURN NULL;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Attach Triggers to Key Tables
DROP TRIGGER IF EXISTS audit_organizations ON organizations;
CREATE TRIGGER audit_organizations AFTER INSERT OR UPDATE OR DELETE ON organizations FOR EACH ROW EXECUTE FUNCTION log_audit_event();

DROP TRIGGER IF EXISTS audit_members ON members;
CREATE TRIGGER audit_members AFTER INSERT OR UPDATE OR DELETE ON members FOR EACH ROW EXECUTE FUNCTION log_audit_event();

DROP TRIGGER IF EXISTS audit_working_groups ON working_groups;
CREATE TRIGGER audit_working_groups AFTER INSERT OR UPDATE OR DELETE ON working_groups FOR EACH ROW EXECUTE FUNCTION log_audit_event();

DROP TRIGGER IF EXISTS audit_events ON events;
CREATE TRIGGER audit_events AFTER INSERT OR UPDATE OR DELETE ON events FOR EACH ROW EXECUTE FUNCTION log_audit_event();

DROP TRIGGER IF EXISTS audit_wiki_docs ON wiki_docs;
CREATE TRIGGER audit_wiki_docs AFTER INSERT OR UPDATE OR DELETE ON wiki_docs FOR EACH ROW EXECUTE FUNCTION log_audit_event();

DROP TRIGGER IF EXISTS audit_feed_items ON feed_items;
CREATE TRIGGER audit_feed_items AFTER INSERT OR UPDATE OR DELETE ON feed_items FOR EACH ROW EXECUTE FUNCTION log_audit_event();

DROP TRIGGER IF EXISTS audit_files ON files;
CREATE TRIGGER audit_files AFTER INSERT OR UPDATE OR DELETE ON files FOR EACH ROW EXECUTE FUNCTION log_audit_event();

DROP TRIGGER IF EXISTS audit_skills ON skills;
CREATE TRIGGER audit_skills AFTER INSERT OR UPDATE OR DELETE ON skills FOR EACH ROW EXECUTE FUNCTION log_audit_event();

DROP TRIGGER IF EXISTS audit_ag_memberships ON ag_memberships;
CREATE TRIGGER audit_ag_memberships AFTER INSERT OR UPDATE OR DELETE ON ag_memberships FOR EACH ROW EXECUTE FUNCTION log_audit_event();
