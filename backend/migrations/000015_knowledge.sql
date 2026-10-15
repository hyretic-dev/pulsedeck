-- Up migration
-- Wissensbasis (RAG): Herkunft der Abschnitte (für die Rechteprüfung beim Abruf), Inhaltsprüfsumme (nächtliche
-- Aktualisierung ohne unnötige Embedding-Aufrufe) und Indexaufträge für Dateien (Ersatz von ingest-file/ingest-docs).

ALTER TABLE knowledge_base
    ADD COLUMN source_type text NOT NULL DEFAULT 'doc'
        CONSTRAINT knowledge_source_type_check CHECK (source_type IN ('doc', 'file', 'working_group', 'event')),
    ADD COLUMN source_id uuid,
    ADD COLUMN content_hash text;

UPDATE knowledge_base SET source_type = 'file', source_id = file_id WHERE file_id IS NOT NULL;

CREATE INDEX idx_kb_source ON knowledge_base (source_type, source_id);

CREATE TABLE index_jobs (
    file_id uuid PRIMARY KEY REFERENCES files (id) ON DELETE CASCADE,
    attempts integer NOT NULL DEFAULT 0,
    next_attempt_at timestamptz NOT NULL DEFAULT now(),
    locked_until timestamptz,
    last_error text,
    created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON index_jobs TO pulsedeck_runtime;

-- Down migration
REVOKE SELECT, INSERT, UPDATE, DELETE ON index_jobs FROM pulsedeck_runtime;
DROP TABLE index_jobs;
DROP INDEX idx_kb_source;
ALTER TABLE knowledge_base DROP COLUMN content_hash, DROP COLUMN source_id, DROP COLUMN source_type;
