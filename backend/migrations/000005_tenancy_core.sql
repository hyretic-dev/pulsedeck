-- Up migration
-- Mandantenkern: Organisationen, Rollen, Mitgliedschaften. Abgeleitet aus dem rekonstruierten
-- Live-Schema (docs/migration/04-rechte-matrix.md), ohne Supabase-Plattformobjekte:
--  * keine RLS und keine Trigger (E4/E5: Rechte und Nebenwirkungen liegen im Backend)
--  * auth.users -> auth_users
--  * members.email als citext (case-insensitiv wie auth_users)
--  * Rolle und Mitglied müssen zur selben Organisation gehören (Verbund-FK); im Bestand ließ
--    sich eine fremde Rolle zuweisen
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE organizations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text NOT NULL UNIQUE,
  name text NOT NULL,
  description text,
  logo_url text,
  primary_color text DEFAULT '#e3000f',
  subscription_tier text DEFAULT 'free'
    CONSTRAINT organizations_subscription_tier_check CHECK (subscription_tier IN ('free', 'pro', 'pro_bono')),
  max_members integer DEFAULT 10,
  owner_id uuid REFERENCES auth_users (id) ON DELETE SET NULL,
  branding_enabled boolean DEFAULT true,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
CREATE INDEX idx_organizations_owner ON organizations (owner_id);

CREATE TABLE organization_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  name text NOT NULL,
  description text,
  permissions text[] DEFAULT '{}',
  is_system_admin boolean DEFAULT false,
  is_default boolean DEFAULT false,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE (organization_id, name),
  UNIQUE (id, organization_id)
);

CREATE TABLE members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid REFERENCES organizations (id) ON DELETE CASCADE,
  user_id uuid REFERENCES auth_users (id),
  role_id uuid NOT NULL,
  app_role text DEFAULT 'member'
    CONSTRAINT members_app_role_check CHECK (app_role IN ('public', 'member', 'committee', 'admin')),
  permissions text[] DEFAULT '{}',
  name text NOT NULL,
  role text,
  department text,
  status text NOT NULL
    CONSTRAINT members_status_check CHECK (status IN ('Active', 'Inactive', 'Pending')),
  email citext NOT NULL,
  join_date text NOT NULL,
  avatar_url text,
  street text,
  zip_code text,
  city text,
  phone text,
  birthday text,
  custom_info text,
  contact_channels jsonb DEFAULT '{}',
  connection_token text,
  calendar_token text DEFAULT encode(gen_random_bytes(16), 'hex'),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  CONSTRAINT members_email_org_unique UNIQUE (email, organization_id),
  CONSTRAINT members_role_same_org_fkey FOREIGN KEY (role_id, organization_id)
    REFERENCES organization_roles (id, organization_id) ON DELETE RESTRICT
);
-- user_id und organization_id: Auflösung der Mitgliedschaften eines Kontos
CREATE INDEX idx_members_user_id ON members (user_id);
CREATE INDEX idx_members_organization ON members (organization_id);
-- Ein Konto hat höchstens eine Mitgliedschaft je Organisation. Der Bestand erzwingt das nicht
-- (get_my_role() & Co. nehmen bei Mehrfachzeilen eine beliebige); der Import meldet Verstöße.
CREATE UNIQUE INDEX members_user_org_key ON members (user_id, organization_id) WHERE user_id IS NOT NULL;
-- Verknüpfung per E-Mail (noch nicht verbundene Mitglieder)
CREATE INDEX idx_members_email ON members (email) WHERE user_id IS NULL;
CREATE INDEX idx_members_connection_token ON members (connection_token);
CREATE UNIQUE INDEX idx_members_calendar_token ON members (calendar_token);

GRANT SELECT, INSERT, UPDATE, DELETE ON organizations, organization_roles, members TO pulsedeck_runtime;

-- Down migration
REVOKE SELECT, INSERT, UPDATE, DELETE ON organizations, organization_roles, members FROM pulsedeck_runtime;
DROP TABLE members;
DROP TABLE organization_roles;
DROP TABLE organizations;
