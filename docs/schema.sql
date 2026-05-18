-- JobDone schema rewrite (clean slate — no production data)
-- Run in Supabase SQL Editor.

-- 1. Enable pgvector
CREATE EXTENSION IF NOT EXISTS vector;

-- 2. Drop old tables if present (clean rewrite)
DROP FUNCTION IF EXISTS match_entries(TEXT, vector(1024), INT, FLOAT);
DROP FUNCTION IF EXISTS match_entries(TEXT, vector, INT, DOUBLE PRECISION);
DROP FUNCTION IF EXISTS increment_tag_vocabulary(TEXT, UUID);
DROP TABLE IF EXISTS jobs CASCADE;
DROP TABLE IF EXISTS context_clues CASCADE;
DROP TABLE IF EXISTS entry_contacts CASCADE;
DROP TABLE IF EXISTS entry_tags CASCADE;
DROP TABLE IF EXISTS tag_vocabulary CASCADE;
DROP TABLE IF EXISTS tags CASCADE;
DROP TABLE IF EXISTS tag_categories CASCADE;
DROP TABLE IF EXISTS entry_locations CASCADE;
DROP TABLE IF EXISTS locations CASCADE;
DROP TABLE IF EXISTS entries CASCADE;
DROP TABLE IF EXISTS people CASCADE;
DROP TABLE IF EXISTS feedback CASCADE;
DROP TABLE IF EXISTS queries CASCADE;

-- 3. entries (1024-dim embeddings from voyage-3-lite)
CREATE TABLE entries (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id              TEXT NOT NULL,
  capture_id           TEXT,
  transcript           TEXT NOT NULL,
  summary              TEXT NOT NULL,
  embedding            vector(1024),
  embedding_model      TEXT,
  created_at           TIMESTAMPTZ NOT NULL,
  synced_at            TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX entries_user_id_idx         ON entries(user_id);
CREATE INDEX entries_created_at_idx      ON entries(created_at DESC);
CREATE INDEX entries_embedding_idx       ON entries USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);
CREATE UNIQUE INDEX entries_user_id_capture_id_uidx ON entries(user_id, capture_id) WHERE capture_id IS NOT NULL;
CREATE UNIQUE INDEX entries_user_id_created_at_uidx ON entries(user_id, created_at) WHERE capture_id IS NULL;

ALTER TABLE entries ENABLE ROW LEVEL SECURITY;
CREATE POLICY "backend_insert_entries" ON entries FOR INSERT WITH CHECK (TRUE);
CREATE POLICY "backend_select_entries" ON entries FOR SELECT USING (TRUE);
CREATE POLICY "backend_update_entries" ON entries FOR UPDATE USING (TRUE);

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
CREATE POLICY "backend_insert_context_clues" ON context_clues FOR INSERT WITH CHECK (TRUE);
CREATE POLICY "backend_select_context_clues" ON context_clues FOR SELECT USING (TRUE);
CREATE POLICY "backend_update_context_clues" ON context_clues FOR UPDATE USING (TRUE);
CREATE POLICY "backend_delete_context_clues" ON context_clues FOR DELETE USING (TRUE);

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
CREATE POLICY "backend_insert_locations" ON locations FOR INSERT WITH CHECK (TRUE);
CREATE POLICY "backend_select_locations" ON locations FOR SELECT USING (TRUE);
CREATE POLICY "backend_update_locations" ON locations FOR UPDATE USING (TRUE);
CREATE POLICY "backend_delete_locations" ON locations FOR DELETE USING (TRUE);

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
CREATE POLICY "backend_insert_entry_locations" ON entry_locations FOR INSERT WITH CHECK (TRUE);
CREATE POLICY "backend_select_entry_locations" ON entry_locations FOR SELECT USING (TRUE);
CREATE POLICY "backend_delete_entry_locations" ON entry_locations FOR DELETE USING (TRUE);

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
CREATE POLICY "backend_insert_tag_categories" ON tag_categories FOR INSERT WITH CHECK (TRUE);
CREATE POLICY "backend_select_tag_categories" ON tag_categories FOR SELECT USING (TRUE);
CREATE POLICY "backend_update_tag_categories" ON tag_categories FOR UPDATE USING (TRUE);
CREATE POLICY "backend_delete_tag_categories" ON tag_categories FOR DELETE USING (TRUE);

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
CREATE POLICY "backend_insert_tags" ON tags FOR INSERT WITH CHECK (TRUE);
CREATE POLICY "backend_select_tags" ON tags FOR SELECT USING (TRUE);
CREATE POLICY "backend_update_tags" ON tags FOR UPDATE USING (TRUE);
CREATE POLICY "backend_delete_tags" ON tags FOR DELETE USING (TRUE);

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
CREATE POLICY "backend_insert_tag_vocabulary" ON tag_vocabulary FOR INSERT WITH CHECK (TRUE);
CREATE POLICY "backend_select_tag_vocabulary" ON tag_vocabulary FOR SELECT USING (TRUE);
CREATE POLICY "backend_update_tag_vocabulary" ON tag_vocabulary FOR UPDATE USING (TRUE);
CREATE POLICY "backend_delete_tag_vocabulary" ON tag_vocabulary FOR DELETE USING (TRUE);

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
CREATE POLICY "backend_insert_entry_tags" ON entry_tags FOR INSERT WITH CHECK (TRUE);
CREATE POLICY "backend_select_entry_tags" ON entry_tags FOR SELECT USING (TRUE);
CREATE POLICY "backend_delete_entry_tags" ON entry_tags FOR DELETE USING (TRUE);

CREATE OR REPLACE FUNCTION increment_tag_vocabulary(
  p_user_id TEXT,
  p_tag_id UUID
)
RETURNS VOID
LANGUAGE plpgsql
AS $$
BEGIN
  INSERT INTO tag_vocabulary (user_id, tag_id, use_count, accepted_count, rejected_count, last_used_at)
  VALUES (p_user_id, p_tag_id, 1, 1, 0, NOW())
  ON CONFLICT (user_id, tag_id)
  DO UPDATE SET
    use_count = tag_vocabulary.use_count + 1,
    accepted_count = tag_vocabulary.accepted_count + 1,
    last_used_at = NOW();
END;
$$;

-- 8. people (local-first Contacts created from confirmed Captures)
-- The table name stays "people" for compatibility with deployed clients; product language is Contacts.
CREATE TABLE people (
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

CREATE INDEX people_user_id_idx           ON people(user_id);
CREATE INDEX people_updated_at_idx        ON people(updated_at DESC);
CREATE INDEX people_normalized_phones_idx ON people USING GIN (normalized_phones);
CREATE INDEX people_normalized_emails_idx ON people USING GIN (normalized_emails);
CREATE UNIQUE INDEX people_user_id_local_id_uidx ON people(user_id, local_id) WHERE local_id IS NOT NULL;

ALTER TABLE people ENABLE ROW LEVEL SECURITY;
CREATE POLICY "backend_insert_people" ON people FOR INSERT WITH CHECK (TRUE);
CREATE POLICY "backend_select_people" ON people FOR SELECT USING (TRUE);
CREATE POLICY "backend_update_people" ON people FOR UPDATE USING (TRUE);
CREATE POLICY "backend_delete_people" ON people FOR DELETE USING (TRUE);

-- 9. entry_contacts (immutable MVP Entry-to-Contact associations)
CREATE TABLE entry_contacts (
  id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id   TEXT NOT NULL,
  entry_id  UUID NOT NULL REFERENCES entries(id) ON DELETE CASCADE,
  person_id UUID NOT NULL REFERENCES people(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX entry_contacts_user_id_idx  ON entry_contacts(user_id);
CREATE INDEX entry_contacts_entry_id_idx ON entry_contacts(entry_id);
CREATE INDEX entry_contacts_person_id_idx ON entry_contacts(person_id);
CREATE UNIQUE INDEX entry_contacts_user_entry_person_uidx ON entry_contacts(user_id, entry_id, person_id);

ALTER TABLE entry_contacts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "backend_insert_entry_contacts" ON entry_contacts FOR INSERT WITH CHECK (TRUE);
CREATE POLICY "backend_select_entry_contacts" ON entry_contacts FOR SELECT USING (TRUE);
CREATE POLICY "backend_delete_entry_contacts" ON entry_contacts FOR DELETE USING (TRUE);

-- 10. queries (persisted Recall questions)
CREATE TABLE queries (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    TEXT NOT NULL,
  text       TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX queries_user_id_idx ON queries(user_id);

ALTER TABLE queries ENABLE ROW LEVEL SECURITY;
CREATE POLICY "backend_insert_queries" ON queries FOR INSERT WITH CHECK (TRUE);
CREATE POLICY "backend_select_queries" ON queries FOR SELECT USING (TRUE);

-- 11. feedback (user-submitted issue reports with compact diagnostics)
CREATE TABLE feedback (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           TEXT NOT NULL,
  transcript        TEXT NOT NULL,
  diagnostic_bundle JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX feedback_user_id_idx    ON feedback(user_id);
CREATE INDEX feedback_created_at_idx ON feedback(created_at DESC);

ALTER TABLE feedback ENABLE ROW LEVEL SECURITY;
CREATE POLICY "backend_insert_feedback" ON feedback FOR INSERT WITH CHECK (TRUE);
CREATE POLICY "backend_select_feedback" ON feedback FOR SELECT USING (TRUE);
CREATE POLICY "backend_delete_feedback" ON feedback FOR DELETE USING (TRUE);

-- 11. match_entries RPC — 1024-dim voyage-3-lite embeddings
CREATE OR REPLACE FUNCTION match_entries(
  p_user_id          TEXT,
  p_query_embedding  vector(1024),
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
AS $$
  SELECT
    e.id,
    e.user_id,
    e.transcript,
    e.summary,
    e.created_at,
    1 - (e.embedding <=> p_query_embedding) AS similarity
  FROM entries e
  WHERE e.user_id = p_user_id
    AND e.embedding IS NOT NULL
    AND 1 - (e.embedding <=> p_query_embedding) >= p_similarity_floor
  ORDER BY e.embedding <=> p_query_embedding
  LIMIT p_match_count;
$$;
