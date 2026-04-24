-- Enable Row Level Security (RLS) support explicitly for all tables
-- ROBUST UPDATE SCRIPT: Run this to apply Structural Changes (Columns, Roles) and Policies.
-- Safe to run on existing database (adds columns if missing).

-- 0. Helper Function to get current user role
CREATE OR REPLACE FUNCTION get_my_role()
RETURNS TEXT AS $$
DECLARE
  v_user_role TEXT;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN 'public';
  END IF;
  SELECT app_role INTO v_user_role FROM public.members WHERE user_id = auth.uid();
  RETURN COALESCE(v_user_role, 'public');
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 0b. Helper to get current member_id
CREATE OR REPLACE FUNCTION get_my_member_id()
RETURNS UUID AS $$
BEGIN
  RETURN (SELECT id FROM public.members WHERE user_id = auth.uid() LIMIT 1);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 0c. Check if user is member of a specific working group
CREATE OR REPLACE FUNCTION is_member_of_ag(ag_id UUID)
RETURNS BOOLEAN AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM working_group_members wgm
    WHERE wgm.working_group_id = ag_id
    AND wgm.member_id = get_my_member_id()
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


-- 1. Contacts
CREATE TABLE IF NOT EXISTS contacts (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  role TEXT NOT NULL,
  description TEXT NOT NULL,
  email TEXT NOT NULL,
  phone TEXT,
  location TEXT NOT NULL,
  image_url TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE contacts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Contacts Visibility" ON contacts;
DROP POLICY IF EXISTS "Contacts Manage" ON contacts;

CREATE POLICY "Contacts Visibility" ON contacts FOR SELECT 
USING (get_my_role() IN ('member', 'committee', 'admin'));

CREATE POLICY "Contacts Manage" ON contacts FOR ALL 
USING (get_my_role() = 'admin');


-- 2. Members
CREATE TABLE IF NOT EXISTS members (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  role TEXT NOT NULL,
  department TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('Active', 'Inactive', 'Pending')),
  email TEXT NOT NULL,
  join_date TEXT NOT NULL,
  avatar_url TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- MIGRATION: Add columns if missing
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='members' AND column_name='user_id') THEN
        ALTER TABLE members ADD COLUMN user_id UUID REFERENCES auth.users(id);
        CREATE INDEX IF NOT EXISTS msg_user_id_idx ON members(user_id);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='members' AND column_name='app_role') THEN
        ALTER TABLE members ADD COLUMN app_role TEXT DEFAULT 'member' CHECK (app_role IN ('public', 'member', 'committee', 'admin'));
    END IF;
    -- Profile Fields
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='members' AND column_name='street') THEN
        ALTER TABLE members ADD COLUMN street TEXT;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='members' AND column_name='zip_code') THEN
        ALTER TABLE members ADD COLUMN zip_code TEXT;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='members' AND column_name='city') THEN
        ALTER TABLE members ADD COLUMN city TEXT;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='members' AND column_name='phone') THEN
        ALTER TABLE members ADD COLUMN phone TEXT;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='members' AND column_name='birthday') THEN
        ALTER TABLE members ADD COLUMN birthday TEXT;
    END IF;
    
    -- Relax constraints on legacy fields if they exist
    BEGIN
        ALTER TABLE members ALTER COLUMN department DROP NOT NULL;
    EXCEPTION WHEN OTHERS THEN NULL; END;
    BEGIN
        ALTER TABLE members ALTER COLUMN role DROP NOT NULL;
    EXCEPTION WHEN OTHERS THEN NULL; END;
END $$;

ALTER TABLE members ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Members Visibility" ON members;
DROP POLICY IF EXISTS "Members Manage" ON members;

-- Allow users to see their own record, admins see all
CREATE POLICY "Members Visibility" ON members FOR SELECT 
USING (
  get_my_role() = 'admin' 
  OR user_id = auth.uid()
);

CREATE POLICY "Members Manage" ON members FOR ALL 
USING (get_my_role() = 'admin');


-- 3. Events
CREATE TABLE IF NOT EXISTS events (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  title TEXT NOT NULL,
  date TEXT NOT NULL, 
  start_time TEXT NOT NULL,
  end_time TEXT,
  type TEXT NOT NULL CHECK (type IN ('general', 'personal', 'ag')),
  location TEXT NOT NULL,
  description TEXT,
  ag_name TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- MIGRATION: Add columns
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='events' AND column_name='allowed_roles') THEN
        ALTER TABLE events ADD COLUMN allowed_roles TEXT[] DEFAULT '{public,member,committee,admin}';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='events' AND column_name='working_group_id') THEN
        ALTER TABLE events ADD COLUMN working_group_id UUID REFERENCES working_groups(id) ON DELETE SET NULL;
    END IF;
END $$;

ALTER TABLE events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Events Visibility" ON events;
DROP POLICY IF EXISTS "Events Manage" ON events;

-- Visibility: User has role in allowed_roles OR is member of linked AG
CREATE POLICY "Events Visibility" ON events FOR SELECT 
USING (
  get_my_role() = ANY(allowed_roles)
  OR (working_group_id IS NOT NULL AND is_member_of_ag(working_group_id))
);

CREATE POLICY "Events Manage" ON events FOR ALL 
USING (get_my_role() = 'admin');


-- 4. Working Groups
CREATE TABLE IF NOT EXISTS working_groups (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL,
  lead TEXT NOT NULL,
  members_count INTEGER DEFAULT 0,
  next_meeting TEXT, -- Can be NULL, will be computed from events
  contact_type TEXT NOT NULL,
  contact_value TEXT, 
  contact_link TEXT,
  contact_icon TEXT NOT NULL,
  tags TEXT[] DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE working_groups ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "AG Visibility" ON working_groups;
DROP POLICY IF EXISTS "AG Manage" ON working_groups;

CREATE POLICY "AG Visibility" ON working_groups FOR SELECT USING (true);

CREATE POLICY "AG Manage" ON working_groups FOR ALL 
USING (get_my_role() = 'admin');


-- 4b. AG Memberships (Join Function)
CREATE TABLE IF NOT EXISTS working_group_members (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  working_group_id UUID REFERENCES working_groups(id) ON DELETE CASCADE,
  member_id UUID REFERENCES members(id) ON DELETE CASCADE,
  joined_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(working_group_id, member_id)
);

ALTER TABLE working_group_members ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "AG Mem Visibility" ON working_group_members;
DROP POLICY IF EXISTS "AG Mem Add Self" ON working_group_members;
DROP POLICY IF EXISTS "AG Mem Remove Self" ON working_group_members;

CREATE POLICY "AG Mem Visibility" ON working_group_members FOR SELECT USING (get_my_role() IN ('member', 'committee', 'admin'));

-- Admins can add anyone, members can add themselves
CREATE POLICY "AG Mem Add Self" ON working_group_members FOR INSERT 
WITH CHECK (
  get_my_role() = 'admin' 
  OR (
    get_my_role() IN ('member', 'committee') AND 
    member_id IN (SELECT id FROM members WHERE user_id = auth.uid())
  )
);

-- Admins can remove anyone, members can remove themselves
CREATE POLICY "AG Mem Remove Self" ON working_group_members FOR DELETE 
USING (
  get_my_role() = 'admin' 
  OR (
    get_my_role() IN ('member', 'committee') AND 
    member_id IN (SELECT id FROM members WHERE user_id = auth.uid())
  )
);


-- 4c. Trigger to update members_count automatically
CREATE OR REPLACE FUNCTION update_ag_members_count()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE working_groups SET members_count = (
      SELECT COUNT(*) FROM working_group_members WHERE working_group_id = NEW.working_group_id
    ) WHERE id = NEW.working_group_id;
  ELSIF TG_OP = 'DELETE' THEN
    UPDATE working_groups SET members_count = (
      SELECT COUNT(*) FROM working_group_members WHERE working_group_id = OLD.working_group_id
    ) WHERE id = OLD.working_group_id;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_ag_members_count ON working_group_members;
CREATE TRIGGER trg_ag_members_count
AFTER INSERT OR DELETE ON working_group_members
FOR EACH ROW EXECUTE FUNCTION update_ag_members_count();


-- 5. Wiki Docs
CREATE TABLE IF NOT EXISTS wiki_docs (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  content TEXT,
  last_updated TEXT NOT NULL,
  author TEXT NOT NULL,
  category TEXT NOT NULL CHECK (category IN ('General', 'Finance', 'Tech', 'Legal')),
  status TEXT NOT NULL CHECK (status IN ('Published', 'Draft', 'Review')),
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- MIGRATION
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='wiki_docs' AND column_name='allowed_roles') THEN
        ALTER TABLE wiki_docs ADD COLUMN allowed_roles TEXT[] DEFAULT '{public,member,committee,admin}';
    END IF;
END $$;

ALTER TABLE wiki_docs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Wiki Visibility" ON wiki_docs;
DROP POLICY IF EXISTS "Wiki Manage" ON wiki_docs;

CREATE POLICY "Wiki Visibility" ON wiki_docs FOR SELECT 
USING (get_my_role() = ANY(allowed_roles));

CREATE POLICY "Wiki Manage" ON wiki_docs FOR ALL 
USING (get_my_role() = 'admin');


-- DUMMY DATA (Only if empty, to avoid duplicates)
INSERT INTO members (name, role, department, status, email, join_date, app_role)
SELECT 'Super Admin', 'Vorstand', 'Management', 'Active', 'admin@pulsedeck.de', '01.01.2020', 'admin'
WHERE NOT EXISTS (SELECT 1 FROM members WHERE email = 'admin@pulsedeck.de');

INSERT INTO members (name, role, department, status, email, join_date, app_role)
SELECT 'Normal Member', 'Mitglied', 'Diverse', 'Active', 'member@pulsedeck.de', '01.06.2024', 'member'
WHERE NOT EXISTS (SELECT 1 FROM members WHERE email = 'member@pulsedeck.de');

-- Important: To test Admin rights, you must link your Supabase Auth UID to the 'Super Admin' member row!
-- Run: UPDATE members SET user_id = 'YOUR-AUTH-UID' WHERE email = 'admin@pulsedeck.de';
