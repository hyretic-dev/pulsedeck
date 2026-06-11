-- Add is_pinned to files
ALTER TABLE public.files 
ADD COLUMN IF NOT EXISTS is_pinned BOOLEAN NOT NULL DEFAULT false;

-- Create folders table
CREATE TABLE IF NOT EXISTS public.folders (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    parent_id UUID REFERENCES public.folders(id) ON DELETE CASCADE,
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    created_by UUID REFERENCES public.members(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ DEFAULT now()
);

-- Add folder_id FK to files (replaces the text-based folder field)
ALTER TABLE public.files 
ADD COLUMN IF NOT EXISTS folder_id UUID REFERENCES public.folders(id) ON DELETE SET NULL;

-- Indexes
CREATE INDEX IF NOT EXISTS idx_files_is_pinned 
ON public.files(is_pinned) WHERE is_pinned = true;

CREATE INDEX IF NOT EXISTS idx_files_created_at 
ON public.files(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_files_folder_id 
ON public.files(folder_id);

CREATE INDEX IF NOT EXISTS idx_folders_organization_id 
ON public.folders(organization_id);

CREATE INDEX IF NOT EXISTS idx_folders_parent_id 
ON public.folders(parent_id);

-- Enable RLS on folders
ALTER TABLE public.folders ENABLE ROW LEVEL SECURITY;

-- Folders: All org members can see folders
CREATE POLICY "Org members can see folders"
ON public.folders FOR SELECT
TO authenticated
USING (
    organization_id IN (
        SELECT organization_id FROM public.members 
        WHERE user_id = auth.uid()
    )
);

-- Folders: Admin/Committee can create folders
CREATE POLICY "Admin and committee can create folders"
ON public.folders FOR INSERT
TO authenticated
WITH CHECK (
    organization_id IN (
        SELECT organization_id FROM public.members 
        WHERE user_id = auth.uid() 
        AND app_role IN ('admin', 'committee')
    )
);

-- Folders: Admin/Committee can update folders
CREATE POLICY "Admin and committee can update folders"
ON public.folders FOR UPDATE
TO authenticated
USING (
    organization_id IN (
        SELECT organization_id FROM public.members 
        WHERE user_id = auth.uid() 
        AND app_role IN ('admin', 'committee')
    )
);

-- Folders: Admin can delete folders
CREATE POLICY "Admin can delete folders"
ON public.folders FOR DELETE
TO authenticated
USING (
    organization_id IN (
        SELECT organization_id FROM public.members 
        WHERE user_id = auth.uid() 
        AND app_role = 'admin'
    )
);
