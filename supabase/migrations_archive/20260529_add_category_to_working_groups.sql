-- Migration: Add category column to working_groups
-- Adds a nullable free-text category field for grouping/filtering working groups per organization.

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_name = 'working_groups'
        AND column_name = 'category'
    ) THEN
        ALTER TABLE working_groups
        ADD COLUMN category TEXT;

        COMMENT ON COLUMN working_groups.category IS
            'Optional free-text category for grouping (e.g. AGs, Mandatsträger). '
            'NULL means no category assigned.';
    END IF;
END $$;
