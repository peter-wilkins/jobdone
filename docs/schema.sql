-- JobDone schema rewrite (clean slate — no production data)
-- Run in Supabase SQL Editor.

-- 1. Enable pgvector
CREATE EXTENSION IF NOT EXISTS vector;

-- 2. Drop old tables if present (clean rewrite)
DROP FUNCTION IF EXISTS match_entries(TEXT, vector(1024), INT, FLOAT);
DROP FUNCTION IF EXISTS match_entries(TEXT, vector, INT, DOUBLE PRECISION);
DROP TABLE IF EXISTS jobs CASCADE;
DROP TABLE IF EXISTS context_clues CASCADE;
DROP TABLE IF EXISTS entries CASCADE;
DROP TABLE IF EXISTS people CASCADE;
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

-- 5. people (local-first Contacts created from confirmed Captures)
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

-- 6. queries (persisted Recall questions)
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

-- 7. match_entries RPC — 1024-dim voyage-3-lite embeddings
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
