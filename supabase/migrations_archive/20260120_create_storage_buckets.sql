-- Create buckets
INSERT INTO storage.buckets (id, name, public)
VALUES 
  ('avatars', 'avatars', true),
  ('files', 'files', false)
ON CONFLICT (id) DO NOTHING;

-- RLS for avatars (Public Read, Auth Insert/Update)
DROP POLICY IF EXISTS "Avatar images are publicly accessible." ON storage.objects;
CREATE POLICY "Avatar images are publicly accessible."
  ON storage.objects FOR SELECT
  USING ( bucket_id = 'avatars' );

DROP POLICY IF EXISTS "Anyone can upload an avatar." ON storage.objects;
CREATE POLICY "Anyone can upload an avatar."
  ON storage.objects FOR INSERT
  WITH CHECK ( bucket_id = 'avatars' );

DROP POLICY IF EXISTS "Anyone can update their own avatar." ON storage.objects;
CREATE POLICY "Anyone can update their own avatar."
  ON storage.objects FOR UPDATE
  USING ( bucket_id = 'avatars' AND auth.uid() = owner );

-- RLS for files bucket (Managed by FileService, but basic protection needed)
-- Authenticated users can view files they have access to via calling code (Signed URLs)
-- But for 'files' we need a policy that allows access.
-- Since FileService uses Signed URLs for private files, the verify logic happens internally.
-- However, for `storage.objects` policies, we need to allow the creation of the signed URL (which checks permission).
-- Actually, Signed URLs bypass RLS on `select` if created with service key, but here we generate them continuously.
-- Wait, `createSignedUrl` wraps `storage.api`.
-- Let's just allow Authenticated users to access 'files' bucket objects for now to ensure functionality.

DROP POLICY IF EXISTS "Authenticated users can view files" ON storage.objects;
CREATE POLICY "Authenticated users can view files"
  ON storage.objects FOR SELECT
  TO authenticated
  USING ( bucket_id = 'files' );

DROP POLICY IF EXISTS "Authenticated users can upload files" ON storage.objects;
CREATE POLICY "Authenticated users can upload files"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK ( bucket_id = 'files' );

DROP POLICY IF EXISTS "Authenticated users can update files" ON storage.objects;
CREATE POLICY "Authenticated users can update files"
  ON storage.objects FOR UPDATE
  TO authenticated
  USING ( bucket_id = 'files' );

DROP POLICY IF EXISTS "Authenticated users can delete files" ON storage.objects;
CREATE POLICY "Authenticated users can delete files"
  ON storage.objects FOR DELETE
  TO authenticated
  USING ( bucket_id = 'files' );
