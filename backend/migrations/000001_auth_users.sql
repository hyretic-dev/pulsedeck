-- Up migration
CREATE EXTENSION IF NOT EXISTS citext WITH SCHEMA public;

-- Auth-Benutzer; UUIDs sind Supabase-UUID-kompatibel (Import übernimmt bestehende IDs).
CREATE TABLE auth_users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email citext NOT NULL,
  password_hash text NOT NULL,
  email_verified boolean NOT NULL DEFAULT false,
  is_blocked boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX auth_users_email_key ON auth_users (email);

-- Down migration
DROP TABLE auth_users;
DROP EXTENSION IF EXISTS citext;
