-- Migration to add file indexing support for RAG

-- 1. Add tracking to files table
ALTER TABLE public.files 
ADD COLUMN IF NOT EXISTS is_indexed BOOLEAN NOT NULL DEFAULT false;

-- 2. Add foreign key to knowledge_base
ALTER TABLE public.knowledge_base
ADD COLUMN IF NOT EXISTS file_id UUID REFERENCES public.files(id) ON DELETE CASCADE;

-- 3. Add Index for fast lookups
CREATE INDEX IF NOT EXISTS idx_files_is_indexed ON public.files(is_indexed);
CREATE INDEX IF NOT EXISTS idx_kb_file_id ON public.knowledge_base(file_id);

-- 4. Update knowledge_base RLS to respect file visibility
DROP POLICY IF EXISTS "Users can read global knowledge or their org knowledge" ON public.knowledge_base;

CREATE POLICY "Users can read global knowledge or their org knowledge"
    ON public.knowledge_base FOR SELECT
    USING (
        (organization_id IS NULL OR 
         organization_id IN (
            SELECT organization_id FROM public.members WHERE user_id = auth.uid()
         ))
        AND
        (file_id IS NULL OR 
         EXISTS (SELECT 1 FROM public.files WHERE id = file_id)
        )
    );
