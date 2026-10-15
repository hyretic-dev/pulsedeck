-- Up migration
-- Plattform-Administratoren (ersetzt die fest einkodierte „Super Admin“-UUID in Policies und Frontend) und Organisationsbezug
-- von Feedback (damit Organisationen ihr eigenes Feedback sehen, ohne fremdes zu lesen).

ALTER TABLE auth_users ADD COLUMN is_platform_admin boolean NOT NULL DEFAULT false;

ALTER TABLE feedback_submissions ADD COLUMN organization_id uuid REFERENCES organizations (id) ON DELETE SET NULL;
CREATE INDEX idx_feedback_org ON feedback_submissions (organization_id, created_at DESC);
ALTER TABLE feedback_submissions ADD CONSTRAINT feedback_status_check CHECK (status IN ('new', 'in_progress', 'done'));
ALTER TABLE feedback_submissions ADD CONSTRAINT feedback_type_check CHECK (type IN ('bug', 'suggestion'));

-- Down migration
ALTER TABLE feedback_submissions DROP CONSTRAINT feedback_type_check;
ALTER TABLE feedback_submissions DROP CONSTRAINT feedback_status_check;
DROP INDEX idx_feedback_org;
ALTER TABLE feedback_submissions DROP COLUMN organization_id;
ALTER TABLE auth_users DROP COLUMN is_platform_admin;
