-- 1. Dokumentation der Spalte aktualisieren
COMMENT ON COLUMN members.permissions IS 'Array of permission keys: feed:create, feed:approve, wiki:edit, events:create, contacts:edit, view_issue_tracker';

-- 2. Bestehende Admins/Committee-Mitglieder mit der neuen Permission ausstatten
UPDATE members 
SET permissions = array_append(permissions, 'view_issue_tracker')
WHERE app_role IN ('admin', 'committee') 
  AND NOT ('view_issue_tracker' = ANY(COALESCE(permissions, '{}')));
