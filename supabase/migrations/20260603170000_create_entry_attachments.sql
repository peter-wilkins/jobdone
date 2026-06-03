SET search_path = jobdone, extensions, public;

CREATE TABLE IF NOT EXISTS entry_attachments (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        TEXT NOT NULL,
  entry_id       UUID NOT NULL REFERENCES entries(id) ON DELETE CASCADE,
  local_id       TEXT NOT NULL,
  kind           TEXT NOT NULL CHECK (kind IN ('photo')),
  filename       TEXT NOT NULL DEFAULT '',
  mime_type      TEXT NOT NULL DEFAULT 'image/jpeg',
  byte_size      INTEGER NOT NULL DEFAULT 0,
  width          INTEGER,
  height         INTEGER,
  data           BYTEA NOT NULL,
  metadata       JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS entry_attachments_user_id_idx
  ON entry_attachments(user_id);

CREATE INDEX IF NOT EXISTS entry_attachments_entry_id_idx
  ON entry_attachments(entry_id);

CREATE UNIQUE INDEX IF NOT EXISTS entry_attachments_user_entry_local_uidx
  ON entry_attachments(user_id, entry_id, local_id);

ALTER TABLE entry_attachments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS deny_all_direct_access ON entry_attachments;
CREATE POLICY deny_all_direct_access
  ON entry_attachments
  FOR ALL
  USING (false)
  WITH CHECK (false);

GRANT ALL ON TABLE entry_attachments TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE entry_attachments TO jobdone_backend;

DROP POLICY IF EXISTS backend_direct_access ON entry_attachments;
CREATE POLICY backend_direct_access
  ON entry_attachments
  FOR ALL
  TO jobdone_backend
  USING (true)
  WITH CHECK (true);
