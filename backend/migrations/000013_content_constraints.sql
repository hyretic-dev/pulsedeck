-- Up migration
-- Wiki-Kategorien: Namen sind je Organisation (globale Kategorien) bzw. je Arbeitsgruppe eindeutig.
-- Der Bestands-Constraint greift bei working_group_id IS NULL nicht, weil NULL-Werte als verschieden gelten.

CREATE UNIQUE INDEX wiki_categories_global_name_key ON wiki_categories (organization_id, name) WHERE working_group_id IS NULL;

-- Down migration
DROP INDEX wiki_categories_global_name_key;
