-- Up migration
-- Arbeitsgruppen. working_group_members und ag_memberships bestehen im Bestand parallel und werden
-- bewusst nicht zusammengeführt (Gesamtauftrag §7). Der Zähler members_count wird vom Service gepflegt
-- (E5), nicht von einem Trigger.

CREATE TABLE working_groups (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    description text NOT NULL,
    lead text NOT NULL,
    members_count integer DEFAULT 0,
    next_meeting text NOT NULL,
    contact_type text NOT NULL,
    contact_value text,
    contact_link text,
    contact_icon text NOT NULL,
    tags text[] DEFAULT '{}'::text[],
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    organization_id uuid,
    category text,
    CONSTRAINT working_groups_contact_type_check CHECK ((contact_type = ANY (ARRAY['Signal'::text, 'Discord'::text, 'WhatsApp'::text, 'Email'::text])))
);

CREATE TABLE working_group_members (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    working_group_id uuid,
    member_id uuid,
    joined_at timestamp with time zone DEFAULT now()
);

CREATE TABLE ag_memberships (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    member_id uuid NOT NULL,
    working_group_id uuid NOT NULL,
    role text DEFAULT 'member'::text,
    joined_at timestamp with time zone DEFAULT now(),
    CONSTRAINT ag_memberships_role_check CHECK ((role = ANY (ARRAY['member'::text, 'admin'::text, 'lead'::text])))
);

ALTER TABLE ONLY working_groups
    ADD CONSTRAINT working_groups_pkey PRIMARY KEY (id);

ALTER TABLE ONLY working_group_members
    ADD CONSTRAINT working_group_members_pkey PRIMARY KEY (id);

ALTER TABLE ONLY working_group_members
    ADD CONSTRAINT working_group_members_working_group_id_member_id_key UNIQUE (working_group_id, member_id);

ALTER TABLE ONLY ag_memberships
    ADD CONSTRAINT ag_memberships_member_id_working_group_id_key UNIQUE (member_id, working_group_id);

ALTER TABLE ONLY ag_memberships
    ADD CONSTRAINT ag_memberships_pkey PRIMARY KEY (id);

CREATE INDEX idx_working_groups_organization ON working_groups USING btree (organization_id);

CREATE INDEX idx_ag_memberships_group ON ag_memberships USING btree (working_group_id);

CREATE INDEX idx_ag_memberships_member ON ag_memberships USING btree (member_id);

ALTER TABLE ONLY working_groups
    ADD CONSTRAINT working_groups_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE;

ALTER TABLE ONLY working_group_members
    ADD CONSTRAINT working_group_members_member_id_fkey FOREIGN KEY (member_id) REFERENCES members(id) ON DELETE CASCADE;

ALTER TABLE ONLY working_group_members
    ADD CONSTRAINT working_group_members_working_group_id_fkey FOREIGN KEY (working_group_id) REFERENCES working_groups(id) ON DELETE CASCADE;

ALTER TABLE ONLY ag_memberships
    ADD CONSTRAINT ag_memberships_member_id_fkey FOREIGN KEY (member_id) REFERENCES members(id) ON DELETE CASCADE;

ALTER TABLE ONLY ag_memberships
    ADD CONSTRAINT ag_memberships_working_group_id_fkey FOREIGN KEY (working_group_id) REFERENCES working_groups(id) ON DELETE CASCADE;

GRANT SELECT, INSERT, UPDATE, DELETE ON working_groups, working_group_members, ag_memberships TO pulsedeck_runtime;


-- Down migration
REVOKE SELECT, INSERT, UPDATE, DELETE ON working_groups, working_group_members, ag_memberships FROM pulsedeck_runtime;
DROP TABLE ag_memberships;
DROP TABLE working_group_members;
DROP TABLE working_groups;
