-- Up migration
-- Festfenster-Rate-Limits; der Zähler wird atomar per Upsert erhöht.
CREATE TABLE rate_limits (
  key text NOT NULL,
  window_start timestamptz NOT NULL,
  count integer NOT NULL DEFAULT 0,
  PRIMARY KEY (key, window_start)
);

-- Down migration
DROP TABLE rate_limits;
