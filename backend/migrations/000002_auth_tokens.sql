-- Up migration
-- Serverseitig gespeicherte Session-Refresh-Tokens: nur SHA-256-Hashes, nie Klartext.
CREATE TABLE refresh_tokens (
  token_hash text PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth_users (id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL
);

CREATE INDEX refresh_tokens_user_id_idx ON refresh_tokens (user_id);

-- Zweckgebundene, einmalig einlösbare Tokens (E-Mail-Verifikation, Magic Link, Passwort-Reset).
CREATE TABLE verification_tokens (
  purpose text NOT NULL,
  token_hash text NOT NULL,
  user_id uuid NOT NULL REFERENCES auth_users (id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL,
  PRIMARY KEY (purpose, token_hash)
);

CREATE INDEX verification_tokens_user_id_idx ON verification_tokens (user_id);

-- Down migration
DROP TABLE verification_tokens;
DROP TABLE refresh_tokens;
