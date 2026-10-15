-- Up migration
-- Kontakte, Feed (inkl. Umfragen), Newsletter-Konfiguration, Wiki.
-- newsletter_config ist im Bestand eine globale Einzelzeile (CHECK id = 1); hier eine Zeile je Organisation.
-- Das SMTP-Passwort liegt nur verschlüsselt (AES-256-GCM, Schlüssel aus der Umgebung) und wird nie ausgeliefert.

CREATE TABLE contacts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    role text NOT NULL,
    description text NOT NULL,
    email text NOT NULL,
    phone text,
    location text NOT NULL,
    image_url text,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    organization_id uuid
);

CREATE TABLE feed_items (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    title text NOT NULL,
    content text,
    url text,
    type text DEFAULT 'article'::text,
    status text DEFAULT 'draft'::text,
    author_id uuid NOT NULL,
    sent_at timestamp with time zone,
    organization_id uuid,
    poll_config jsonb,
    is_public boolean DEFAULT true,
    working_group_id uuid,
    is_pinned boolean DEFAULT false NOT NULL,
    CONSTRAINT feed_items_status_check CHECK ((status = ANY (ARRAY['draft'::text, 'review'::text, 'approved'::text, 'sent'::text]))),
    CONSTRAINT feed_items_type_check CHECK ((type = ANY (ARRAY['article'::text, 'link'::text, 'poll'::text])))
);

CREATE TABLE poll_options (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    feed_item_id uuid NOT NULL,
    text text NOT NULL,
    sort_order integer DEFAULT 0,
    created_at timestamp with time zone DEFAULT now()
);

CREATE TABLE poll_votes (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    option_id uuid NOT NULL,
    member_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now()
);

CREATE TABLE feed_item_reads (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    feed_item_id uuid NOT NULL,
    member_id uuid NOT NULL,
    read_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE newsletter_config (
    organization_id uuid NOT NULL,
    frequency text DEFAULT 'weekly'::text,
    day_of_week integer DEFAULT 5,
    time_of_day time without time zone DEFAULT '12:00:00'::time without time zone,
    last_sent_at timestamp with time zone,
    active boolean DEFAULT false,
    logo_url text DEFAULT ''::text,
    footer_text text DEFAULT 'Lexion - Vereinsverwaltung'::text,
    primary_color text DEFAULT '#DE0000'::text,
    smtp_host text,
    smtp_port integer,
    smtp_user text,
    smtp_pass_encrypted text,
    smtp_from text,
    smtp_secure boolean DEFAULT true,
    CONSTRAINT newsletter_config_frequency_check CHECK ((frequency = ANY (ARRAY['weekly'::text, 'monthly'::text, 'manual'::text])))
);

CREATE TABLE wiki_categories (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid NOT NULL,
    working_group_id uuid,
    name text NOT NULL,
    icon text,
    sort_order integer DEFAULT 0,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);

CREATE TABLE wiki_docs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    title text NOT NULL,
    description text NOT NULL,
    content text,
    last_updated text NOT NULL,
    author text NOT NULL,
    status text NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    allowed_roles text[] DEFAULT '{public,member,committee,admin}'::text[],
    organization_id uuid NOT NULL,
    working_group_id uuid,
    category uuid,
    CONSTRAINT wiki_docs_status_check CHECK ((status = ANY (ARRAY['Published'::text, 'Draft'::text, 'Review'::text])))
);

ALTER TABLE ONLY contacts
    ADD CONSTRAINT contacts_pkey PRIMARY KEY (id);

ALTER TABLE ONLY feed_items
    ADD CONSTRAINT feed_items_pkey PRIMARY KEY (id);

ALTER TABLE ONLY poll_options
    ADD CONSTRAINT poll_options_pkey PRIMARY KEY (id);

ALTER TABLE ONLY poll_votes
    ADD CONSTRAINT poll_votes_option_id_member_id_key UNIQUE (option_id, member_id);

ALTER TABLE ONLY poll_votes
    ADD CONSTRAINT poll_votes_pkey PRIMARY KEY (id);

ALTER TABLE ONLY feed_item_reads
    ADD CONSTRAINT feed_item_reads_feed_item_id_member_id_key UNIQUE (feed_item_id, member_id);

ALTER TABLE ONLY feed_item_reads
    ADD CONSTRAINT feed_item_reads_pkey PRIMARY KEY (id);

ALTER TABLE ONLY newsletter_config
    ADD CONSTRAINT newsletter_config_pkey PRIMARY KEY (organization_id);

ALTER TABLE ONLY wiki_categories
    ADD CONSTRAINT wiki_categories_organization_id_working_group_id_name_key UNIQUE (organization_id, working_group_id, name);

ALTER TABLE ONLY wiki_categories
    ADD CONSTRAINT wiki_categories_pkey PRIMARY KEY (id);

ALTER TABLE ONLY wiki_docs
    ADD CONSTRAINT wiki_docs_pkey PRIMARY KEY (id);

CREATE INDEX idx_contacts_organization ON contacts USING btree (organization_id);

CREATE INDEX idx_feed_items_is_pinned ON feed_items USING btree (is_pinned) WHERE (is_pinned = true);

CREATE INDEX idx_feed_items_organization ON feed_items USING btree (organization_id);

CREATE INDEX idx_feed_items_working_group_id ON feed_items USING btree (working_group_id);

CREATE INDEX idx_wiki_categories_org ON wiki_categories USING btree (organization_id);

CREATE INDEX idx_wiki_categories_wg ON wiki_categories USING btree (working_group_id);

CREATE INDEX idx_wiki_docs_category ON wiki_docs USING btree (category);

ALTER TABLE ONLY contacts
    ADD CONSTRAINT contacts_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE;

ALTER TABLE ONLY feed_items
    ADD CONSTRAINT feed_items_author_id_fkey FOREIGN KEY (author_id) REFERENCES members(id);

ALTER TABLE ONLY feed_items
    ADD CONSTRAINT feed_items_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE;

ALTER TABLE ONLY feed_items
    ADD CONSTRAINT feed_items_working_group_id_fkey FOREIGN KEY (working_group_id) REFERENCES working_groups(id) ON DELETE SET NULL;

ALTER TABLE ONLY poll_options
    ADD CONSTRAINT poll_options_feed_item_id_fkey FOREIGN KEY (feed_item_id) REFERENCES feed_items(id) ON DELETE CASCADE;

ALTER TABLE ONLY poll_votes
    ADD CONSTRAINT poll_votes_member_id_fkey FOREIGN KEY (member_id) REFERENCES members(id) ON DELETE CASCADE;

ALTER TABLE ONLY poll_votes
    ADD CONSTRAINT poll_votes_option_id_fkey FOREIGN KEY (option_id) REFERENCES poll_options(id) ON DELETE CASCADE;

ALTER TABLE ONLY feed_item_reads
    ADD CONSTRAINT feed_item_reads_feed_item_id_fkey FOREIGN KEY (feed_item_id) REFERENCES feed_items(id) ON DELETE CASCADE;

ALTER TABLE ONLY feed_item_reads
    ADD CONSTRAINT feed_item_reads_member_id_fkey FOREIGN KEY (member_id) REFERENCES members(id) ON DELETE CASCADE;

ALTER TABLE ONLY wiki_categories
    ADD CONSTRAINT wiki_categories_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE;

ALTER TABLE ONLY wiki_categories
    ADD CONSTRAINT wiki_categories_working_group_id_fkey FOREIGN KEY (working_group_id) REFERENCES working_groups(id) ON DELETE CASCADE;

ALTER TABLE ONLY wiki_docs
    ADD CONSTRAINT wiki_docs_category_fkey FOREIGN KEY (category) REFERENCES wiki_categories(id) ON DELETE SET NULL;

ALTER TABLE ONLY wiki_docs
    ADD CONSTRAINT wiki_docs_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE;

ALTER TABLE ONLY wiki_docs
    ADD CONSTRAINT wiki_docs_working_group_id_fkey FOREIGN KEY (working_group_id) REFERENCES working_groups(id) ON DELETE SET NULL;

ALTER TABLE ONLY newsletter_config
    ADD CONSTRAINT newsletter_config_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE;

GRANT SELECT, INSERT, UPDATE, DELETE ON contacts, feed_items, poll_options, poll_votes, feed_item_reads, newsletter_config, wiki_categories, wiki_docs TO pulsedeck_runtime;


-- Down migration
REVOKE SELECT, INSERT, UPDATE, DELETE ON contacts, feed_items, poll_options, poll_votes, feed_item_reads, newsletter_config, wiki_categories, wiki_docs FROM pulsedeck_runtime;
DROP TABLE wiki_docs;
DROP TABLE wiki_categories;
DROP TABLE newsletter_config;
DROP TABLE feed_item_reads;
DROP TABLE poll_votes;
DROP TABLE poll_options;
DROP TABLE feed_items;
DROP TABLE contacts;
