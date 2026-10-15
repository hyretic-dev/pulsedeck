-- Up migration
-- Rollen-Trennung (Auftrag §4): die Runtime-Rolle erhält nur DML auf den
-- App-Tabellen, kein DDL und keine Ownership. Die Rolle selbst (LOGIN/Passwort)
-- erzeugt das Compose-Setup aus Env-Werten, nicht die Migration.
GRANT SELECT, INSERT, UPDATE, DELETE ON auth_users, refresh_tokens,
  verification_tokens, rate_limits TO pulsedeck_runtime;

-- Down migration
REVOKE SELECT, INSERT, UPDATE, DELETE ON auth_users, refresh_tokens,
  verification_tokens, rate_limits FROM pulsedeck_runtime;
