-- Up migration
-- pgvector ist keine „trusted“ Extension: Sie muss einmalig mit Superuser-Rechten angelegt werden
-- (docker/postgres/10-roles.sh bei leerem Volume; für bestehende Volumes siehe docs/betrieb/selfhosting.md).
-- Die Migrations-Rolle selbst darf sie nicht anlegen; bei Fehlen bricht die Migration mit einer klaren Meldung ab.
DO $$
BEGIN
  CREATE EXTENSION IF NOT EXISTS vector;
EXCEPTION WHEN insufficient_privilege THEN
  RAISE EXCEPTION 'Extension vector fehlt. Einmalig als Superuser ausführen: CREATE EXTENSION vector; (siehe docs/betrieb/selfhosting.md)';
END $$;

-- Ordner, Dateien (Metadaten; Binärdaten liegen im Objektspeicher) und Wissensbasis für den Chatbot (pgvector).

CREATE TABLE folders (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    parent_id uuid,
    organization_id uuid NOT NULL,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now()
);

CREATE TABLE files (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    original_name text NOT NULL,
    storage_path text NOT NULL,
    mime_type text,
    size_bytes bigint,
    folder text DEFAULT '/'::text,
    description text,
    uploaded_by uuid,
    working_group_id uuid,
    visibility text DEFAULT 'member'::text,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    organization_id uuid,
    is_pinned boolean DEFAULT false NOT NULL,
    folder_id uuid,
    is_indexed boolean DEFAULT false NOT NULL,
    CONSTRAINT files_visibility_check CHECK ((visibility = ANY (ARRAY['public'::text, 'member'::text, 'committee'::text, 'admin'::text, 'ag-only'::text])))
);

CREATE TABLE knowledge_base (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    title text NOT NULL,
    content text NOT NULL,
    embedding vector(1024),
    organization_id uuid,
    created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    file_id uuid
);

ALTER TABLE ONLY folders
    ADD CONSTRAINT folders_pkey PRIMARY KEY (id);

ALTER TABLE ONLY files
    ADD CONSTRAINT files_pkey PRIMARY KEY (id);

ALTER TABLE ONLY knowledge_base
    ADD CONSTRAINT knowledge_base_pkey PRIMARY KEY (id);

CREATE INDEX idx_folders_organization_id ON folders USING btree (organization_id);

CREATE INDEX idx_folders_parent_id ON folders USING btree (parent_id);

CREATE INDEX idx_files_created_at ON files USING btree (created_at DESC);

CREATE INDEX idx_files_folder ON files USING btree (folder);

CREATE INDEX idx_files_folder_id ON files USING btree (folder_id);

CREATE INDEX idx_files_is_indexed ON files USING btree (is_indexed);

CREATE INDEX idx_files_is_pinned ON files USING btree (is_pinned) WHERE (is_pinned = true);

CREATE INDEX idx_files_organization ON files USING btree (organization_id);

CREATE INDEX idx_files_organization_id ON files USING btree (organization_id);

CREATE INDEX idx_files_uploaded_by ON files USING btree (uploaded_by);

CREATE INDEX idx_files_working_group ON files USING btree (working_group_id);

CREATE INDEX idx_files_working_group_id ON files USING btree (working_group_id);

CREATE INDEX idx_kb_file_id ON knowledge_base USING btree (file_id);

CREATE INDEX knowledge_base_embedding_idx ON knowledge_base USING hnsw (embedding vector_cosine_ops);

ALTER TABLE ONLY folders
    ADD CONSTRAINT folders_created_by_fkey FOREIGN KEY (created_by) REFERENCES members(id) ON DELETE SET NULL;

ALTER TABLE ONLY folders
    ADD CONSTRAINT folders_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE;

ALTER TABLE ONLY folders
    ADD CONSTRAINT folders_parent_id_fkey FOREIGN KEY (parent_id) REFERENCES folders(id) ON DELETE CASCADE;

ALTER TABLE ONLY files
    ADD CONSTRAINT files_folder_id_fkey FOREIGN KEY (folder_id) REFERENCES folders(id) ON DELETE SET NULL;

ALTER TABLE ONLY files
    ADD CONSTRAINT files_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE;

ALTER TABLE ONLY files
    ADD CONSTRAINT files_uploaded_by_fkey FOREIGN KEY (uploaded_by) REFERENCES members(id) ON DELETE SET NULL;

ALTER TABLE ONLY files
    ADD CONSTRAINT files_working_group_id_fkey FOREIGN KEY (working_group_id) REFERENCES working_groups(id) ON DELETE SET NULL;

ALTER TABLE ONLY knowledge_base
    ADD CONSTRAINT knowledge_base_file_id_fkey FOREIGN KEY (file_id) REFERENCES files(id) ON DELETE CASCADE;

ALTER TABLE ONLY knowledge_base
    ADD CONSTRAINT knowledge_base_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE;

GRANT SELECT, INSERT, UPDATE, DELETE ON folders, files, knowledge_base TO pulsedeck_runtime;


-- Down migration
REVOKE SELECT, INSERT, UPDATE, DELETE ON folders, files, knowledge_base FROM pulsedeck_runtime;
DROP TABLE knowledge_base;
DROP TABLE files;
DROP TABLE folders;
