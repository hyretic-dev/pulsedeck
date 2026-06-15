-- Enable pgvector extension
CREATE EXTENSION IF NOT EXISTS vector WITH SCHEMA public;

-- Create knowledge_base table
CREATE TABLE IF NOT EXISTS public.knowledge_base (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    title TEXT NOT NULL,
    content TEXT NOT NULL,
    embedding VECTOR(1024), -- mistral-embed dimensions
    organization_id UUID REFERENCES public.organizations(id) ON DELETE CASCADE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Create HNSW index for faster similarity search
CREATE INDEX ON public.knowledge_base USING hnsw (embedding vector_cosine_ops);

-- RLS Policies
ALTER TABLE public.knowledge_base ENABLE ROW LEVEL SECURITY;

-- Allow read access for authenticated users 
CREATE POLICY "Users can read global knowledge or their org knowledge"
    ON public.knowledge_base FOR SELECT
    USING (
        organization_id IS NULL OR 
        organization_id IN (
            SELECT organization_id FROM public.members WHERE user_id = auth.uid()
        )
    );

-- Function for similarity search
CREATE OR REPLACE FUNCTION match_knowledge (
  query_embedding vector(1024),
  match_threshold float,
  match_count int,
  org_id uuid DEFAULT NULL
)
RETURNS TABLE (
  id uuid,
  title text,
  content text,
  similarity float
)
LANGUAGE sql STABLE
AS $$
  SELECT
    kb.id,
    kb.title,
    kb.content,
    1 - (kb.embedding <=> query_embedding) AS similarity
  FROM public.knowledge_base kb
  WHERE 
    1 - (kb.embedding <=> query_embedding) > match_threshold
    AND (
      kb.organization_id IS NULL 
      OR kb.organization_id = org_id
    )
  ORDER BY kb.embedding <=> query_embedding
  LIMIT match_count;
$$;
