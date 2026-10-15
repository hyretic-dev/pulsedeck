-- Up migration
-- Termine, Anmeldungen, Helferslots, Gastorganisationen.

CREATE TABLE events (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    title text NOT NULL,
    date text NOT NULL,
    start_time text NOT NULL,
    end_time text,
    location text NOT NULL,
    description text,
    ag_name text,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    allowed_roles text[] DEFAULT '{public,member,committee,admin}'::text[],
    working_group_id uuid,
    max_participants integer,
    registration_required boolean DEFAULT false,
    organization_id uuid,
    meeting_reason text,
    location_type text,
    is_recurring boolean DEFAULT false,
    recurrence_interval text,
    recurrence_parent_id uuid,
    CONSTRAINT events_location_type_check CHECK ((location_type = ANY (ARRAY['discord'::text, 'zoom'::text, 'onsite'::text, 'other'::text]))),
    CONSTRAINT events_recurrence_interval_check CHECK ((recurrence_interval = ANY (ARRAY['biweekly'::text, 'monthly'::text, 'quarterly'::text])))
);

CREATE TABLE event_registrations (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    event_id uuid NOT NULL,
    member_id uuid NOT NULL,
    status text DEFAULT 'confirmed'::text,
    registered_at timestamp with time zone DEFAULT now(),
    note text,
    CONSTRAINT event_registrations_status_check CHECK ((status = ANY (ARRAY['confirmed'::text, 'maybe'::text, 'cancelled'::text])))
);

CREATE TABLE event_slots (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid NOT NULL,
    event_id uuid NOT NULL,
    title text NOT NULL,
    start_time time without time zone,
    end_time time without time zone,
    max_helpers integer DEFAULT 1 NOT NULL,
    sort_order integer DEFAULT 0,
    created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at timestamp with time zone DEFAULT timezone('utc'::text, now()),
    required_skills text[] DEFAULT '{}'::text[]
);

CREATE TABLE event_slot_signups (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid NOT NULL,
    slot_id uuid NOT NULL,
    member_id uuid NOT NULL,
    status text DEFAULT 'confirmed'::text NOT NULL,
    note text,
    signed_up_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    CONSTRAINT event_slot_signups_status_check CHECK ((status = ANY (ARRAY['confirmed'::text, 'cancelled'::text])))
);

CREATE TABLE event_guest_organizations (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    event_id uuid NOT NULL,
    host_organization_id uuid NOT NULL,
    guest_organization_id uuid,
    guest_org_name text,
    guest_org_email text,
    guest_org_contact_name text,
    status text DEFAULT 'pending'::text,
    invited_by uuid,
    invited_at timestamp with time zone DEFAULT now(),
    responded_at timestamp with time zone,
    CONSTRAINT event_guest_organizations_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'accepted'::text, 'declined'::text])))
);

ALTER TABLE ONLY events
    ADD CONSTRAINT events_pkey PRIMARY KEY (id);

ALTER TABLE ONLY event_registrations
    ADD CONSTRAINT event_registrations_event_id_member_id_key UNIQUE (event_id, member_id);

ALTER TABLE ONLY event_registrations
    ADD CONSTRAINT event_registrations_pkey PRIMARY KEY (id);

ALTER TABLE ONLY event_slots
    ADD CONSTRAINT event_slots_pkey PRIMARY KEY (id);

ALTER TABLE ONLY event_slot_signups
    ADD CONSTRAINT event_slot_signups_event_slot_id_member_id_key UNIQUE (slot_id, member_id);

ALTER TABLE ONLY event_slot_signups
    ADD CONSTRAINT event_slot_signups_pkey PRIMARY KEY (id);

ALTER TABLE ONLY event_guest_organizations
    ADD CONSTRAINT event_guest_organizations_event_id_guest_org_email_key UNIQUE (event_id, guest_org_email);

ALTER TABLE ONLY event_guest_organizations
    ADD CONSTRAINT event_guest_organizations_event_id_guest_organization_id_key UNIQUE (event_id, guest_organization_id);

ALTER TABLE ONLY event_guest_organizations
    ADD CONSTRAINT event_guest_organizations_pkey PRIMARY KEY (id);

CREATE INDEX idx_events_organization ON events USING btree (organization_id);

CREATE INDEX idx_events_recurrence_parent ON events USING btree (recurrence_parent_id) WHERE (recurrence_parent_id IS NOT NULL);

CREATE INDEX idx_event_registrations_event ON event_registrations USING btree (event_id);

CREATE INDEX idx_event_registrations_member ON event_registrations USING btree (member_id);

CREATE INDEX idx_event_guest_orgs_event ON event_guest_organizations USING btree (event_id);

CREATE INDEX idx_event_guest_orgs_guest ON event_guest_organizations USING btree (guest_organization_id);

CREATE INDEX idx_event_guest_orgs_host ON event_guest_organizations USING btree (host_organization_id);

ALTER TABLE ONLY events
    ADD CONSTRAINT events_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE;

ALTER TABLE ONLY events
    ADD CONSTRAINT events_recurrence_parent_id_fkey FOREIGN KEY (recurrence_parent_id) REFERENCES events(id) ON DELETE SET NULL;

ALTER TABLE ONLY events
    ADD CONSTRAINT fk_events_working_group FOREIGN KEY (working_group_id) REFERENCES working_groups(id) ON DELETE CASCADE;

ALTER TABLE ONLY event_registrations
    ADD CONSTRAINT event_registrations_event_id_fkey FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE;

ALTER TABLE ONLY event_registrations
    ADD CONSTRAINT event_registrations_member_id_fkey FOREIGN KEY (member_id) REFERENCES members(id) ON DELETE CASCADE;

ALTER TABLE ONLY event_slots
    ADD CONSTRAINT event_slots_event_id_fkey FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE;

ALTER TABLE ONLY event_slots
    ADD CONSTRAINT event_slots_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE;

ALTER TABLE ONLY event_slot_signups
    ADD CONSTRAINT event_slot_signups_event_slot_id_fkey FOREIGN KEY (slot_id) REFERENCES event_slots(id) ON DELETE CASCADE;

ALTER TABLE ONLY event_slot_signups
    ADD CONSTRAINT event_slot_signups_member_id_fkey FOREIGN KEY (member_id) REFERENCES members(id) ON DELETE CASCADE;

ALTER TABLE ONLY event_slot_signups
    ADD CONSTRAINT event_slot_signups_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE;

ALTER TABLE ONLY event_guest_organizations
    ADD CONSTRAINT event_guest_organizations_event_id_fkey FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE;

ALTER TABLE ONLY event_guest_organizations
    ADD CONSTRAINT event_guest_organizations_guest_organization_id_fkey FOREIGN KEY (guest_organization_id) REFERENCES organizations(id) ON DELETE SET NULL;

ALTER TABLE ONLY event_guest_organizations
    ADD CONSTRAINT event_guest_organizations_host_organization_id_fkey FOREIGN KEY (host_organization_id) REFERENCES organizations(id) ON DELETE CASCADE;

ALTER TABLE ONLY event_guest_organizations
    ADD CONSTRAINT event_guest_organizations_invited_by_fkey FOREIGN KEY (invited_by) REFERENCES members(id) ON DELETE SET NULL;

GRANT SELECT, INSERT, UPDATE, DELETE ON events, event_registrations, event_slots, event_slot_signups, event_guest_organizations TO pulsedeck_runtime;


-- Down migration
REVOKE SELECT, INSERT, UPDATE, DELETE ON events, event_registrations, event_slots, event_slot_signups, event_guest_organizations FROM pulsedeck_runtime;
DROP TABLE event_guest_organizations;
DROP TABLE event_slot_signups;
DROP TABLE event_slots;
DROP TABLE event_registrations;
DROP TABLE events;
