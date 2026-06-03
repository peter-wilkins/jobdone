-- JobDone schema rewrite (clean slate — no production data)
-- Run in Supabase SQL Editor.

-- 1. Enable pgvector in extensions; keep JobDone-owned objects in jobdone.
CREATE SCHEMA IF NOT EXISTS extensions;
CREATE EXTENSION IF NOT EXISTS vector WITH SCHEMA extensions;
ALTER EXTENSION vector SET SCHEMA extensions;

-- 2. Drop old app objects if present (clean rewrite)
DROP SCHEMA IF EXISTS jobdone CASCADE;
DROP FUNCTION IF EXISTS public.match_entries(TEXT, extensions.vector(1024), INT, FLOAT);
DROP FUNCTION IF EXISTS public.match_entries(TEXT, extensions.vector, INT, DOUBLE PRECISION);
DROP FUNCTION IF EXISTS public.increment_tag_vocabulary(TEXT, UUID);
DROP TABLE IF EXISTS public.jobs CASCADE;
DROP TABLE IF EXISTS public.context_clues CASCADE;
DROP TABLE IF EXISTS public.entry_contacts CASCADE;
DROP TABLE IF EXISTS public.entry_tags CASCADE;
DROP TABLE IF EXISTS public.tag_vocabulary CASCADE;
DROP TABLE IF EXISTS public.tags CASCADE;
DROP TABLE IF EXISTS public.tag_categories CASCADE;
DROP TABLE IF EXISTS public.entry_locations CASCADE;
DROP TABLE IF EXISTS public.locations CASCADE;
DROP TABLE IF EXISTS public.entries CASCADE;
DROP TABLE IF EXISTS public.people CASCADE;
DROP TABLE IF EXISTS public.contacts CASCADE;
DROP TABLE IF EXISTS public.feedback CASCADE;
DROP TABLE IF EXISTS public.queries CASCADE;

CREATE SCHEMA jobdone;
GRANT USAGE ON SCHEMA jobdone TO service_role;
SET search_path = jobdone, extensions, public;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'jobdone_backend') THEN
    CREATE ROLE jobdone_backend NOLOGIN;
  END IF;
END;
$$;

GRANT USAGE ON SCHEMA extensions TO jobdone_backend;
GRANT USAGE ON SCHEMA jobdone TO jobdone_backend;

-- 3. entries (1024-dim embeddings from voyage-3-lite)
CREATE TABLE entries (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id              TEXT NOT NULL,
  capture_id           TEXT,
  transcript           TEXT NOT NULL,
  summary              TEXT NOT NULL,
  embedding            extensions.vector(1024),
  embedding_model      TEXT,
  created_at           TIMESTAMPTZ NOT NULL,
  synced_at            TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX entries_user_id_idx         ON entries(user_id);
CREATE INDEX entries_created_at_idx      ON entries(created_at DESC);
CREATE INDEX entries_embedding_idx       ON entries USING ivfflat (embedding extensions.vector_cosine_ops) WITH (lists = 100);
CREATE UNIQUE INDEX entries_user_id_capture_id_uidx ON entries(user_id, capture_id) WHERE capture_id IS NOT NULL;
CREATE UNIQUE INDEX entries_user_id_created_at_uidx ON entries(user_id, created_at) WHERE capture_id IS NULL;

ALTER TABLE entries ENABLE ROW LEVEL SECURITY;

-- 4. context_clues (internal prediction/debug evidence linked to confirmed Entries)
CREATE TABLE context_clues (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     TEXT NOT NULL,
  entry_id    UUID NOT NULL REFERENCES entries(id) ON DELETE CASCADE,
  local_id    TEXT,
  kind        TEXT NOT NULL,
  source      TEXT NOT NULL,
  summary     TEXT NOT NULL DEFAULT '',
  payload     JSONB NOT NULL DEFAULT '{}'::jsonb,
  confidence  DOUBLE PRECISION,
  metadata    JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX context_clues_user_id_idx    ON context_clues(user_id);
CREATE INDEX context_clues_entry_id_idx   ON context_clues(entry_id);
CREATE INDEX context_clues_kind_idx       ON context_clues(kind);
CREATE UNIQUE INDEX context_clues_user_id_local_id_uidx ON context_clues(user_id, local_id);

ALTER TABLE context_clues ENABLE ROW LEVEL SECURITY;

-- 5. locations (real places associated with confirmed Entries)
CREATE TABLE locations (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       TEXT NOT NULL,
  local_id      TEXT,
  status        TEXT NOT NULL DEFAULT 'confirmed',
  display_name  TEXT NOT NULL DEFAULT '',
  place_text    TEXT NOT NULL DEFAULT '',
  address_text  TEXT NOT NULL DEFAULT '',
  latitude      DOUBLE PRECISION,
  longitude     DOUBLE PRECISION,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX locations_user_id_idx    ON locations(user_id);
CREATE INDEX locations_updated_at_idx ON locations(updated_at DESC);
CREATE UNIQUE INDEX locations_user_id_local_id_uidx ON locations(user_id, local_id) WHERE local_id IS NOT NULL;

ALTER TABLE locations ENABLE ROW LEVEL SECURITY;

-- 6. entry_locations (immutable MVP Entry-to-Location associations)
CREATE TABLE entry_locations (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     TEXT NOT NULL,
  entry_id    UUID NOT NULL REFERENCES entries(id) ON DELETE CASCADE,
  location_id UUID NOT NULL REFERENCES locations(id) ON DELETE CASCADE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX entry_locations_user_id_idx     ON entry_locations(user_id);
CREATE INDEX entry_locations_entry_id_idx    ON entry_locations(entry_id);
CREATE INDEX entry_locations_location_id_idx ON entry_locations(location_id);
CREATE UNIQUE INDEX entry_locations_user_entry_location_uidx ON entry_locations(user_id, entry_id, location_id);

ALTER TABLE entry_locations ENABLE ROW LEVEL SECURITY;

-- 7. tag_categories, tags, vocabulary, and immutable Entry-to-Tag associations
CREATE TABLE tag_categories (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    TEXT NOT NULL,
  name       TEXT NOT NULL,
  slug       TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX tag_categories_user_id_idx ON tag_categories(user_id);
CREATE UNIQUE INDEX tag_categories_user_slug_uidx ON tag_categories(user_id, slug);

ALTER TABLE tag_categories ENABLE ROW LEVEL SECURITY;

CREATE TABLE tags (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          TEXT NOT NULL,
  local_id         TEXT,
  category_id      UUID NOT NULL REFERENCES tag_categories(id) ON DELETE CASCADE,
  label            TEXT NOT NULL,
  normalized_label TEXT NOT NULL,
  status           TEXT NOT NULL DEFAULT 'confirmed',
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX tags_user_id_idx     ON tags(user_id);
CREATE INDEX tags_category_id_idx ON tags(category_id);
CREATE INDEX tags_updated_at_idx  ON tags(updated_at DESC);
CREATE UNIQUE INDEX tags_user_id_local_id_uidx ON tags(user_id, local_id) WHERE local_id IS NOT NULL;
CREATE UNIQUE INDEX tags_user_category_label_uidx ON tags(user_id, category_id, normalized_label);

ALTER TABLE tags ENABLE ROW LEVEL SECURITY;

CREATE TABLE tag_vocabulary (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        TEXT NOT NULL,
  tag_id         UUID NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_used_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  use_count      INTEGER NOT NULL DEFAULT 0,
  accepted_count INTEGER NOT NULL DEFAULT 0,
  rejected_count INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX tag_vocabulary_user_id_idx      ON tag_vocabulary(user_id);
CREATE INDEX tag_vocabulary_last_used_at_idx ON tag_vocabulary(last_used_at DESC);
CREATE UNIQUE INDEX tag_vocabulary_user_tag_uidx ON tag_vocabulary(user_id, tag_id);

ALTER TABLE tag_vocabulary ENABLE ROW LEVEL SECURITY;

CREATE TABLE entry_tags (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    TEXT NOT NULL,
  entry_id   UUID NOT NULL REFERENCES entries(id) ON DELETE CASCADE,
  tag_id     UUID NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX entry_tags_user_id_idx  ON entry_tags(user_id);
CREATE INDEX entry_tags_entry_id_idx ON entry_tags(entry_id);
CREATE INDEX entry_tags_tag_id_idx   ON entry_tags(tag_id);
CREATE UNIQUE INDEX entry_tags_user_entry_tag_uidx ON entry_tags(user_id, entry_id, tag_id);

ALTER TABLE entry_tags ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION increment_tag_vocabulary(
  p_user_id TEXT,
  p_tag_id UUID
)
RETURNS VOID
LANGUAGE plpgsql
SET search_path = jobdone, extensions, public
AS $$
BEGIN
  INSERT INTO jobdone.tag_vocabulary (user_id, tag_id, use_count, accepted_count, rejected_count, last_used_at)
  VALUES (p_user_id, p_tag_id, 1, 1, 0, NOW())
  ON CONFLICT (user_id, tag_id)
  DO UPDATE SET
    use_count = jobdone.tag_vocabulary.use_count + 1,
    accepted_count = jobdone.tag_vocabulary.accepted_count + 1,
    last_used_at = NOW();
END;
$$;

-- 8. contacts (local-first Contacts created from confirmed Captures)
CREATE TABLE contacts (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id            TEXT NOT NULL,
  local_id           TEXT,
  status             TEXT NOT NULL DEFAULT 'confirmed',
  display_name       TEXT NOT NULL DEFAULT '',
  given_name         TEXT NOT NULL DEFAULT '',
  family_name        TEXT NOT NULL DEFAULT '',
  organization       TEXT NOT NULL DEFAULT '',
  title              TEXT NOT NULL DEFAULT '',
  note               TEXT NOT NULL DEFAULT '',
  phones             JSONB NOT NULL DEFAULT '[]'::jsonb,
  emails             JSONB NOT NULL DEFAULT '[]'::jsonb,
  normalized_phones  TEXT[] NOT NULL DEFAULT '{}',
  normalized_emails  TEXT[] NOT NULL DEFAULT '{}',
  primary_phone      TEXT,
  primary_email      TEXT,
  source_capture_ids TEXT[] NOT NULL DEFAULT '{}',
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX contacts_user_id_idx           ON contacts(user_id);
CREATE INDEX contacts_updated_at_idx        ON contacts(updated_at DESC);
CREATE INDEX contacts_normalized_phones_idx ON contacts USING GIN (normalized_phones);
CREATE INDEX contacts_normalized_emails_idx ON contacts USING GIN (normalized_emails);
CREATE UNIQUE INDEX contacts_user_id_local_id_uidx ON contacts(user_id, local_id) WHERE local_id IS NOT NULL;

ALTER TABLE contacts ENABLE ROW LEVEL SECURITY;

-- 9. entry_contacts (immutable MVP Entry-to-Contact associations)
CREATE TABLE entry_contacts (
  id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id   TEXT NOT NULL,
  entry_id  UUID NOT NULL REFERENCES entries(id) ON DELETE CASCADE,
  contact_id UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX entry_contacts_user_id_idx  ON entry_contacts(user_id);
CREATE INDEX entry_contacts_entry_id_idx ON entry_contacts(entry_id);
CREATE INDEX entry_contacts_contact_id_idx ON entry_contacts(contact_id);
CREATE UNIQUE INDEX entry_contacts_user_entry_contact_uidx ON entry_contacts(user_id, entry_id, contact_id);

ALTER TABLE entry_contacts ENABLE ROW LEVEL SECURITY;

-- 10. queries (persisted Recall questions)
CREATE TABLE queries (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    TEXT NOT NULL,
  text       TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX queries_user_id_idx ON queries(user_id);

ALTER TABLE queries ENABLE ROW LEVEL SECURITY;

-- 11. feedback (user-submitted issue reports with compact diagnostics)
CREATE TABLE feedback (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           TEXT,
  identity_class    TEXT NOT NULL DEFAULT 'signed_in'
                    CHECK (identity_class IN ('signed_in', 'anonymous')),
  anonymous_device_id TEXT,
  abuse_key_hash    TEXT,
  transcript        TEXT NOT NULL,
  diagnostic_bundle JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX feedback_user_id_idx              ON feedback(user_id);
CREATE INDEX feedback_anonymous_device_id_idx  ON feedback(anonymous_device_id);
CREATE INDEX feedback_abuse_key_hash_idx       ON feedback(abuse_key_hash);
CREATE INDEX feedback_created_at_idx           ON feedback(created_at DESC);

ALTER TABLE feedback ENABLE ROW LEVEL SECURITY;

-- 12. entry_attachments (compressed durable Photo attachments)
CREATE TABLE entry_attachments (
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

CREATE INDEX entry_attachments_user_id_idx ON entry_attachments(user_id);
CREATE INDEX entry_attachments_entry_id_idx ON entry_attachments(entry_id);
CREATE UNIQUE INDEX entry_attachments_user_entry_local_uidx
  ON entry_attachments(user_id, entry_id, local_id);

ALTER TABLE entry_attachments ENABLE ROW LEVEL SECURITY;

-- 13. match_entries RPC — 1024-dim voyage-3-lite embeddings
CREATE OR REPLACE FUNCTION match_entries(
  p_user_id          TEXT,
  p_query_embedding  extensions.vector(1024),
  p_match_count      INT     DEFAULT 10,
  p_similarity_floor FLOAT   DEFAULT 0.3
)
RETURNS TABLE (
  id                   UUID,
  user_id              TEXT,
  transcript           TEXT,
  summary              TEXT,
  created_at           TIMESTAMPTZ,
  similarity           FLOAT
)
LANGUAGE sql STABLE
SET search_path = jobdone, extensions, public
AS $$
  SELECT
    e.id,
    e.user_id,
    e.transcript,
    e.summary,
    e.created_at,
    1 - (e.embedding <=> p_query_embedding) AS similarity
  FROM jobdone.entries e
  WHERE e.user_id = p_user_id
    AND e.embedding IS NOT NULL
    AND 1 - (e.embedding <=> p_query_embedding) >= p_similarity_floor
  ORDER BY e.embedding <=> p_query_embedding
  LIMIT p_match_count;
$$;

DO $$
DECLARE
  table_record RECORD;
BEGIN
  FOR table_record IN
    SELECT tablename
    FROM pg_tables
    WHERE schemaname = 'jobdone'
  LOOP
    EXECUTE format(
      'CREATE POLICY %I ON %I.%I FOR ALL USING (false) WITH CHECK (false)',
      'deny_all_direct_access',
      'jobdone',
      table_record.tablename
    );

    EXECUTE format(
      'CREATE POLICY %I ON %I.%I FOR ALL TO %I USING (true) WITH CHECK (true)',
      'backend_direct_access',
      'jobdone',
      table_record.tablename,
      'jobdone_backend'
    );
  END LOOP;
END;
$$;

REVOKE ALL ON SCHEMA jobdone FROM PUBLIC, anon, authenticated;
GRANT USAGE ON SCHEMA jobdone TO service_role;
REVOKE ALL ON ALL TABLES IN SCHEMA jobdone FROM PUBLIC, anon, authenticated;
GRANT ALL ON ALL TABLES IN SCHEMA jobdone TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA jobdone TO jobdone_backend;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA jobdone FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA jobdone TO service_role;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA jobdone TO jobdone_backend;

ALTER DEFAULT PRIVILEGES IN SCHEMA jobdone
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO jobdone_backend;

ALTER DEFAULT PRIVILEGES IN SCHEMA jobdone
  GRANT EXECUTE ON FUNCTIONS TO jobdone_backend;
