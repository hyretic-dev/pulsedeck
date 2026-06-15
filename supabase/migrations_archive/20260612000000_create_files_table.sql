-- Create files table
CREATE TABLE IF NOT EXISTS public.files (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    original_name TEXT NOT NULL,
    storage_path TEXT NOT NULL,
    mime_type TEXT,
    size_bytes BIGINT,
    folder TEXT NOT NULL DEFAULT '/',
    description TEXT,
    uploaded_by UUID REFERENCES public.members(id) ON DELETE SET NULL,
    working_group_id UUID REFERENCES public.working_groups(id) ON DELETE CASCADE,
    visibility TEXT NOT NULL CHECK (visibility IN ('public', 'member', 'committee', 'admin', 'ag-only')),
    organization_id UUID REFERENCES public.organizations(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_files_organization_id ON public.files(organization_id);
CREATE INDEX IF NOT EXISTS idx_files_folder ON public.files(folder);
CREATE INDEX IF NOT EXISTS idx_files_working_group_id ON public.files(working_group_id);

-- Enable RLS
ALTER TABLE public.files ENABLE ROW LEVEL SECURITY;

-- Select policies
-- Admin/Committee: can see all files in their org
CREATE POLICY "Admins and committee can see all org files"
ON public.files FOR SELECT
TO authenticated
USING (
    organization_id IN (
        SELECT organization_id FROM public.members 
        WHERE user_id = auth.uid() 
        AND app_role IN ('admin', 'committee')
    )
);

-- Members: can see public and member files
CREATE POLICY "Members can see public and member visibility files"
ON public.files FOR SELECT
TO authenticated
USING (
    organization_id IN (
        SELECT organization_id FROM public.members WHERE user_id = auth.uid()
    )
    AND visibility IN ('public', 'member')
);

-- AG Members: can see ag-only files for their working groups
CREATE POLICY "AG members can see their AG files"
ON public.files FOR SELECT
TO authenticated
USING (
    visibility = 'ag-only'
    AND working_group_id IN (
        SELECT working_group_id FROM public.ag_memberships 
        WHERE member_id IN (SELECT id FROM public.members WHERE user_id = auth.uid())
    )
);

-- Insert policies
-- Members can insert files if they are part of the org
CREATE POLICY "Members can insert files to their org"
ON public.files FOR INSERT
TO authenticated
WITH CHECK (
    organization_id IN (
        SELECT organization_id FROM public.members WHERE user_id = auth.uid()
    )
    AND uploaded_by IN (
        SELECT id FROM public.members WHERE user_id = auth.uid()
    )
);

-- Update policies
-- Uploader can update their own files
CREATE POLICY "Uploader can update their own files"
ON public.files FOR UPDATE
TO authenticated
USING (
    uploaded_by IN (
        SELECT id FROM public.members WHERE user_id = auth.uid()
    )
);

-- Admin can update any file in their org
CREATE POLICY "Admin can update any org file"
ON public.files FOR UPDATE
TO authenticated
USING (
    organization_id IN (
        SELECT organization_id FROM public.members 
        WHERE user_id = auth.uid() 
        AND app_role = 'admin'
    )
);

-- Delete policies
-- Uploader can delete their own files
CREATE POLICY "Uploader can delete their own files"
ON public.files FOR DELETE
TO authenticated
USING (
    uploaded_by IN (
        SELECT id FROM public.members WHERE user_id = auth.uid()
    )
);

-- Admin can delete any file in their org
CREATE POLICY "Admin can delete any org file"
ON public.files FOR DELETE
TO authenticated
USING (
    organization_id IN (
        SELECT organization_id FROM public.members 
        WHERE user_id = auth.uid() 
        AND app_role = 'admin'
    )
);

-- Trigger for updated_at
CREATE OR REPLACE FUNCTION public.handle_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS files_updated_at ON public.files;
CREATE TRIGGER files_updated_at
  BEFORE UPDATE ON public.files
  FOR EACH ROW
  EXECUTE PROCEDURE public.handle_updated_at();
