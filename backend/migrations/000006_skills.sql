-- Up migration
-- Fähigkeiten, Interessen und Verfügbarkeiten je Organisation und ihre Zuordnung zu Mitgliedern.
-- Ohne RLS und Trigger (E4/E5).

CREATE TABLE skills (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid NOT NULL,
    name text NOT NULL,
    category text DEFAULT 'ability'::text NOT NULL,
    icon text,
    description text,
    sort_order integer DEFAULT 0,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);

CREATE TABLE member_skills (
    member_id uuid NOT NULL,
    skill_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now()
);

ALTER TABLE ONLY skills
    ADD CONSTRAINT skills_organization_id_name_key UNIQUE (organization_id, name);

ALTER TABLE ONLY skills
    ADD CONSTRAINT skills_pkey PRIMARY KEY (id);

ALTER TABLE ONLY member_skills
    ADD CONSTRAINT member_skills_pkey PRIMARY KEY (member_id, skill_id);

CREATE INDEX idx_skills_category ON skills USING btree (organization_id, category);

CREATE INDEX idx_skills_org ON skills USING btree (organization_id);

CREATE INDEX idx_member_skills_member ON member_skills USING btree (member_id);

CREATE INDEX idx_member_skills_skill ON member_skills USING btree (skill_id);

ALTER TABLE ONLY skills
    ADD CONSTRAINT skills_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE;

ALTER TABLE ONLY member_skills
    ADD CONSTRAINT member_skills_member_id_fkey FOREIGN KEY (member_id) REFERENCES members(id) ON DELETE CASCADE;

ALTER TABLE ONLY member_skills
    ADD CONSTRAINT member_skills_skill_id_fkey FOREIGN KEY (skill_id) REFERENCES skills(id) ON DELETE CASCADE;

GRANT SELECT, INSERT, UPDATE, DELETE ON skills, member_skills TO pulsedeck_runtime;


-- Down migration
REVOKE SELECT, INSERT, UPDATE, DELETE ON skills, member_skills FROM pulsedeck_runtime;
DROP TABLE member_skills;
DROP TABLE skills;
