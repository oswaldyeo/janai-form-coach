-- Janai Form Coach — sync backend schema (Cloudflare D1 / SQLite).
--
-- Holds the workout LOG only (the same JSON the app keeps in localStorage).
-- Camera frames, pose landmarks and per-set camera blobs never reach this
-- database: the client strips them and the Worker strips them again.
--
-- Apply:  wrangler d1 execute janai-formcoach-sync --remote --file=sync/schema.sql

CREATE TABLE IF NOT EXISTS accounts (
  id            TEXT PRIMARY KEY,
  seq           INTEGER NOT NULL DEFAULT 0,      -- per-account change counter (sync cursor source)
  created_at_ms INTEGER NOT NULL
);

-- Bearer tokens. Only the SHA-256 hash is stored; the raw token is shown to
-- the user once, at creation. kind='device' can read + write; kind='server'
-- is read-only (the Mac-side puller).
CREATE TABLE IF NOT EXISTS tokens (
  token_hash    TEXT PRIMARY KEY,
  account_id    TEXT NOT NULL REFERENCES accounts(id),
  kind          TEXT NOT NULL CHECK (kind IN ('device', 'server')),
  label         TEXT,
  created_at_ms INTEGER NOT NULL,
  last_used_ms  INTEGER,
  revoked_at_ms INTEGER
);
CREATE INDEX IF NOT EXISTS tokens_by_account ON tokens(account_id);

-- One row per workout id per account. client_updated_ms drives last-writer-
-- wins; server_seq is bumped on every accepted change so GET ?since=<cursor>
-- returns each new/edited workout exactly once, independent of device clocks.
CREATE TABLE IF NOT EXISTS workouts (
  account_id        TEXT NOT NULL REFERENCES accounts(id),
  id                TEXT NOT NULL,
  data              TEXT NOT NULL,
  client_updated_ms INTEGER NOT NULL,
  server_seq        INTEGER NOT NULL,
  received_at_ms    INTEGER NOT NULL,
  PRIMARY KEY (account_id, id)
);
CREATE INDEX IF NOT EXISTS workouts_by_seq ON workouts(account_id, server_seq);
