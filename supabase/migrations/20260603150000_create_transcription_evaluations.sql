-- Store dogfooding transcription provider comparisons.
-- Diagnostic material only: losing transcripts are not normal Entry content.

SET search_path = jobdone, extensions, public;

CREATE TABLE IF NOT EXISTS transcription_evaluations (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id               TEXT,
  anonymous_device_id   TEXT,
  identity_key          TEXT NOT NULL,
  capture_id            TEXT NOT NULL,
  entry_id              UUID REFERENCES entries(id) ON DELETE SET NULL,
  selected_source       TEXT NOT NULL,
  review_text           TEXT NOT NULL DEFAULT '',
  edit_distance         INTEGER,
  candidates            JSONB NOT NULL DEFAULT '[]'::jsonb,
  metadata              JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT transcription_evaluations_identity_chk
    CHECK (user_id IS NOT NULL OR anonymous_device_id IS NOT NULL),
  CONSTRAINT transcription_evaluations_candidates_array_chk
    CHECK (jsonb_typeof(candidates) = 'array'),
  CONSTRAINT transcription_evaluations_metadata_object_chk
    CHECK (jsonb_typeof(metadata) = 'object')
);

CREATE INDEX IF NOT EXISTS transcription_evaluations_user_created_idx
  ON transcription_evaluations(user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS transcription_evaluations_device_created_idx
  ON transcription_evaluations(anonymous_device_id, created_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS transcription_evaluations_identity_capture_uidx
  ON transcription_evaluations(identity_key, capture_id);

ALTER TABLE transcription_evaluations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS deny_all_direct_access ON transcription_evaluations;
CREATE POLICY deny_all_direct_access
  ON transcription_evaluations
  FOR ALL
  USING (false)
  WITH CHECK (false);

GRANT ALL ON TABLE transcription_evaluations TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE transcription_evaluations TO jobdone_backend;

DROP POLICY IF EXISTS backend_direct_access ON transcription_evaluations;
CREATE POLICY backend_direct_access
  ON transcription_evaluations
  FOR ALL
  TO jobdone_backend
  USING (true)
  WITH CHECK (true);
