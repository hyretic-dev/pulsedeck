-- ═══════════════════════════════════════════════════════════════════
-- FIX: Organization Creation RLS + GRANT
-- Bug: INSERT on organizations failed with 42501 because
-- GRANT INSERT was never issued (only GRANT SELECT existed).
-- Also tightens the INSERT policy to only allow owner_id = self.
-- ═══════════════════════════════════════════════════════════════════

-- 1. Grant INSERT + UPDATE on organizations to authenticated users
GRANT INSERT, UPDATE ON organizations
  TO authenticated;

-- 2. Recreate INSERT policy (tighter: only own user as owner)
DROP POLICY IF EXISTS "Users can create organizations"
  ON organizations;

CREATE POLICY "Users can create organizations"
  ON organizations FOR INSERT
  TO authenticated
  WITH CHECK (owner_id = auth.uid());

-- 3. UPDATE policy: owner or admin members can update
DROP POLICY IF EXISTS "Owners can update organizations"
  ON organizations;

CREATE POLICY "Owners can update organizations"
  ON organizations FOR UPDATE
  TO authenticated
  USING (
    owner_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM members
      WHERE members.organization_id = organizations.id
        AND members.user_id = auth.uid()
        AND members.app_role = 'admin'
    )
  )
  WITH CHECK (
    owner_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM members
      WHERE members.organization_id = organizations.id
        AND members.user_id = auth.uid()
        AND members.app_role = 'admin'
    )
  );
