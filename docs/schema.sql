-- JobDone disposable MVP schema snapshot.
--
-- Apply with psql, not dashboard copy/paste:
--
--   . ~/.profile
--   psql "$JOBDONE_STAGING_SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f docs/schema.sql
--
-- Staging/prod data is disposable until JobDone exits MVP mode.
--
-- Reality check:
-- - Local Replica sync tables are the current direction for confirmed Entries
--   and future generic app data.
-- - Legacy server-readable tables below still have live callers for Teams,
--   feedback, contacts/locations, and old Recall paths. Do not treat them as
--   the desired long-term backend shape.
-- - The Hickey/decomplex direction is generic storage plus a JobDone policy
--   layer with first-class Product Actions, stateJson validation, outbox
--   effects, and ops events.

-- 1. Enable pgvector in extensions; keep JobDone-owned objects in jobdone.
CREATE SCHEMA IF NOT EXISTS extensions;
CREATE EXTENSION IF NOT EXISTS vector WITH SCHEMA extensions;
ALTER EXTENSION vector SET SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS postgis WITH SCHEMA extensions;
ALTER EXTENSION postgis SET SCHEMA extensions;

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

-- 3. Legacy entries table.
-- Superseded for new Entry sync by Local Replica syncObjects. Kept while old
-- recall/export/delete/team helper paths still have live callers.
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
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "userId"         UUID NOT NULL,
  status           TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','archived','confirmed')),
  "displayName"    TEXT NOT NULL DEFAULT '',
  "placeText"      TEXT NOT NULL DEFAULT '',
  "addressText"    TEXT NOT NULL DEFAULT '',
  geo              extensions.geography(Point, 4326),
  "accuracyMeters" DOUBLE PRECISION,
  "providerPlaceId" TEXT,
  "contentHash"    TEXT NOT NULL DEFAULT '',
  "identityKeys"   TEXT[] NOT NULL DEFAULT '{}',
  "createdAt"      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updatedAt"      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX locations_user_id_idx         ON locations("userId");
CREATE INDEX locations_updated_at_idx      ON locations("updatedAt" DESC);
CREATE INDEX locations_geo_gist_idx        ON locations USING GIST (geo);
CREATE INDEX locations_identity_keys_idx   ON locations USING GIN ("identityKeys");
CREATE UNIQUE INDEX locations_user_id_id_uidx ON locations("userId", id);
CREATE INDEX locations_user_status_updated_idx ON locations("userId", status, "updatedAt" DESC);

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
  "userId"           TEXT NOT NULL,
  "clientId"         TEXT NOT NULL,
  status             TEXT NOT NULL DEFAULT 'confirmed',
  "displayName"      TEXT NOT NULL DEFAULT '',
  "givenName"        TEXT NOT NULL DEFAULT '',
  "familyName"       TEXT NOT NULL DEFAULT '',
  organization       TEXT NOT NULL DEFAULT '',
  title              TEXT NOT NULL DEFAULT '',
  note               TEXT NOT NULL DEFAULT '',
  phones             JSONB NOT NULL DEFAULT '[]'::jsonb,
  emails             JSONB NOT NULL DEFAULT '[]'::jsonb,
  "normalizedPhones" TEXT[] NOT NULL DEFAULT '{}',
  "normalizedEmails" TEXT[] NOT NULL DEFAULT '{}',
  "primaryPhone"     TEXT,
  "primaryEmail"     TEXT,
  "sourceCaptureIds" TEXT[] NOT NULL DEFAULT '{}',
  "contentHash"      TEXT NOT NULL DEFAULT '',
  "identityKeys"     TEXT[] NOT NULL DEFAULT '{}',
  "createdAt"        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updatedAt"        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX contacts_user_id_idx           ON contacts("userId");
CREATE INDEX contacts_updated_at_idx        ON contacts("updatedAt" DESC);
CREATE INDEX contacts_content_hash_idx      ON contacts("userId", "contentHash");
CREATE INDEX contacts_identity_keys_idx     ON contacts USING GIN ("identityKeys");
CREATE INDEX contacts_normalized_phones_idx ON contacts USING GIN ("normalizedPhones");
CREATE INDEX contacts_normalized_emails_idx ON contacts USING GIN ("normalizedEmails");
CREATE UNIQUE INDEX contacts_user_id_client_id_uidx ON contacts("userId", "clientId");

ALTER TABLE contacts ENABLE ROW LEVEL SECURITY;

-- 9. contactClientAliases (one-way immutable Client ID aliases)
CREATE TABLE "contactClientAliases" (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "userId"       TEXT NOT NULL,
  collection     TEXT NOT NULL DEFAULT 'contacts',
  "fromClientId" TEXT NOT NULL,
  "toClientId"   TEXT NOT NULL,
  reason         TEXT NOT NULL DEFAULT 'unknown',
  "createdAt"    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK ("fromClientId" <> "toClientId")
);

CREATE UNIQUE INDEX contact_client_aliases_user_from_uidx
  ON "contactClientAliases"("userId", "fromClientId");
CREATE INDEX contact_client_aliases_user_to_idx
  ON "contactClientAliases"("userId", "toClientId");

ALTER TABLE "contactClientAliases" ENABLE ROW LEVEL SECURITY;

-- 10. entry_contacts (immutable MVP Entry-to-Contact associations)
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

-- 11. queries (persisted Recall questions)
CREATE TABLE queries (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    TEXT NOT NULL,
  text       TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX queries_user_id_idx ON queries(user_id);

ALTER TABLE queries ENABLE ROW LEVEL SECURITY;

-- 12. feedback (user-submitted issue reports with compact diagnostics)
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

-- 13. entry_attachments (compressed durable Photo attachments)
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

-- 14. teams (shared Backlog coordination, owner-managed)
CREATE TABLE teams (
  id                                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name                              TEXT NOT NULL,
  template                          TEXT NOT NULL DEFAULT 'high_trust'
                                    CHECK (template IN ('high_trust', 'low_trust', 'family')),
  points_enabled                    BOOLEAN NOT NULL DEFAULT FALSE,
  approval_mode                     TEXT NOT NULL DEFAULT 'auto'
                                    CHECK (approval_mode IN ('auto', 'manual')),
  workers_can_create_backlog_items  BOOLEAN NOT NULL DEFAULT TRUE,
  require_owner_self_review         BOOLEAN NOT NULL DEFAULT FALSE,
  capture_context                   JSONB,
  created_at                        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX teams_created_at_idx ON teams(created_at ASC);

ALTER TABLE teams ENABLE ROW LEVEL SECURITY;

-- 15. team_members (email-scoped Team membership)
CREATE TABLE team_members (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id          UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  email            TEXT NOT NULL,
  normalized_email TEXT GENERATED ALWAYS AS (lower(btrim(email))) STORED,
  role             TEXT NOT NULL DEFAULT 'worker'
                   CHECK (role IN ('owner', 'worker')),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX team_members_team_id_idx ON team_members(team_id);
CREATE INDEX team_members_normalized_email_idx ON team_members(normalized_email);
CREATE UNIQUE INDEX team_members_team_email_uidx ON team_members(team_id, normalized_email);

ALTER TABLE team_members ENABLE ROW LEVEL SECURITY;

-- 16. team_invites (long-lived email invite links)
CREATE TABLE team_invites (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id            UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  email              TEXT NOT NULL,
  normalized_email   TEXT GENERATED ALWAYS AS (lower(btrim(email))) STORED,
  token_hash         TEXT NOT NULL,
  status             TEXT NOT NULL DEFAULT 'pending'
                     CHECK (status IN ('pending', 'accepted', 'revoked')),
  invited_by_email   TEXT NOT NULL,
  accepted_member_id UUID REFERENCES team_members(id) ON DELETE SET NULL,
  accepted_at        TIMESTAMPTZ,
  revoked_at         TIMESTAMPTZ,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX team_invites_team_id_idx ON team_invites(team_id);
CREATE INDEX team_invites_normalized_email_idx ON team_invites(normalized_email);
CREATE INDEX team_invites_token_hash_idx ON team_invites(token_hash);
CREATE INDEX team_invites_invited_by_created_idx ON team_invites(invited_by_email, created_at DESC);
CREATE UNIQUE INDEX team_invites_team_pending_email_uidx
  ON team_invites(team_id, normalized_email)
  WHERE status = 'pending';

ALTER TABLE team_invites ENABLE ROW LEVEL SECURITY;

-- 17. backlog_items (Team work that can be claimed)
CREATE TABLE backlog_items (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id          UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  description      TEXT NOT NULL,
  points           INTEGER CHECK (points IS NULL OR (points BETWEEN 1 AND 10)),
  status           TEXT NOT NULL DEFAULT 'open'
                   CHECK (status IN ('open', 'claimed', 'submitted', 'needs_more_evidence', 'approved')),
  claimed_by_email TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX backlog_items_team_status_idx ON backlog_items(team_id, status);
CREATE INDEX backlog_items_claimed_by_email_idx ON backlog_items(claimed_by_email);
CREATE INDEX backlog_items_created_at_idx ON backlog_items(created_at DESC);

ALTER TABLE backlog_items ENABLE ROW LEVEL SECURITY;

-- 18. approval_requests (evidence and owner decisions for claimed work)
CREATE TABLE approval_requests (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id         UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  backlog_item_id UUID NOT NULL REFERENCES backlog_items(id) ON DELETE CASCADE,
  status          TEXT NOT NULL DEFAULT 'submitted'
                  CHECK (status IN ('submitted', 'needs_more_evidence', 'approved')),
  evidence_text   TEXT NOT NULL DEFAULT '',
  submitted_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  decided_at      TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX approval_requests_team_status_idx ON approval_requests(team_id, status);
CREATE INDEX approval_requests_backlog_item_idx ON approval_requests(backlog_item_id);
CREATE INDEX approval_requests_submitted_at_idx ON approval_requests(submitted_at ASC);

ALTER TABLE approval_requests ENABLE ROW LEVEL SECURITY;

-- 19. Legacy match_entries RPC.
-- Superseded by Local-First Recall for MVP. Kept only while old recall paths
-- and disposable schema setup still expect it.
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

-- ---------------------------------------------------------------------------
-- Local Replica sync tables
-- See docs/adr/0010-local-replica-sync-protocol.md and decomplex review.
-- ---------------------------------------------------------------------------

CREATE TABLE jobdone."syncTransactions" (
  t             bigint      PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  source        text        NOT NULL CHECK (source IN ('syncPush','system','import','repair')),
  "createdAt"   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE jobdone."syncTransactionActors" (
  t               bigint      PRIMARY KEY REFERENCES jobdone."syncTransactions"(t) ON DELETE CASCADE,
  "actorUserId"   uuid,
  "actorEmail"    text,
  "actorDeviceId" text
);

CREATE TABLE jobdone."syncObjects" (
  id             uuid        NOT NULL,
  "ownerKind"    text        NOT NULL CHECK ("ownerKind" IN ('user','team')),
  "ownerId"      uuid        NOT NULL,
  collection     text        NOT NULL,
  "createdT"     bigint      NOT NULL REFERENCES jobdone."syncTransactions"(t),
  "changedT"     bigint      NOT NULL REFERENCES jobdone."syncTransactions"(t),
  "deletedT"     bigint               REFERENCES jobdone."syncTransactions"(t),
  "createdAt"    timestamptz NOT NULL DEFAULT now(),
  "changedAt"    timestamptz NOT NULL DEFAULT now(),
  "deletedAt"    timestamptz,
  "payloadMeta"  jsonb       NOT NULL DEFAULT '{"codec":"json","encryptionMode":"none","schemaVersion":1}',
  "payloadJson"  jsonb,
  "payloadBytes" bytea,
  "payloadHash"  text,
  PRIMARY KEY (id, "ownerKind", "ownerId")
);

CREATE UNIQUE INDEX syncObjects_owner_collection_id_uidx
  ON jobdone."syncObjects" ("ownerKind", "ownerId", collection, id);
CREATE INDEX syncObjects_owner_changedT_idx
  ON jobdone."syncObjects" ("ownerKind", "ownerId", "changedT" DESC)
  WHERE "deletedT" IS NULL;

CREATE TABLE jobdone."syncObjectPublicProduct" (
  "ownerKind"         text        NOT NULL CHECK ("ownerKind" IN ('user','team')),
  "ownerId"           uuid        NOT NULL,
  collection          text        NOT NULL,
  "objectId"          uuid        NOT NULL,
  "schemaName"        text        NOT NULL,
  "schemaVersion"     integer     NOT NULL CHECK ("schemaVersion" > 0),
  "publicProductJson" jsonb       NOT NULL,
  "changedT"          bigint      NOT NULL REFERENCES jobdone."syncTransactions"(t),
  "changedAt"         timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY ("ownerKind", "ownerId", collection, "objectId"),
  FOREIGN KEY ("ownerKind", "ownerId", collection, "objectId")
    REFERENCES jobdone."syncObjects" ("ownerKind", "ownerId", collection, id)
    ON DELETE CASCADE
);

CREATE INDEX syncObjectPublicProduct_owner_collection_idx
  ON jobdone."syncObjectPublicProduct" ("ownerKind", "ownerId", collection);
CREATE INDEX syncObjectPublicProduct_changedT_idx
  ON jobdone."syncObjectPublicProduct" ("changedT" DESC);

CREATE TABLE jobdone."syncOwnerAccess" (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  "userId"    uuid        NOT NULL,
  "ownerKind" text        NOT NULL CHECK ("ownerKind" IN ('user','team')),
  "ownerId"   uuid        NOT NULL,
  capability  text        NOT NULL CHECK (capability IN ('pull','push','readable_access')),
  "grantedAt" timestamptz NOT NULL DEFAULT now(),
  "revokedAt" timestamptz
);

CREATE UNIQUE INDEX syncOwnerAccess_active_uidx
  ON jobdone."syncOwnerAccess" ("userId", "ownerKind", "ownerId", capability)
  WHERE "revokedAt" IS NULL;
CREATE INDEX syncOwnerAccess_owner_idx
  ON jobdone."syncOwnerAccess" ("ownerKind", "ownerId")
  WHERE "revokedAt" IS NULL;

CREATE TABLE jobdone."syncIntents" (
  id              uuid        PRIMARY KEY,
  "actorUserId"   uuid        NOT NULL,
  "intentHash"    text        NOT NULL,
  status          text        NOT NULL CHECK (status IN ('accepted','rejected','conflict')),
  "resultT"       bigint      REFERENCES jobdone."syncTransactions"(t),
  "resultJson"    jsonb       NOT NULL,
  "createdAt"     timestamptz NOT NULL DEFAULT now(),
  "resolvedAt"    timestamptz
);

CREATE INDEX syncIntents_actor_created_idx
  ON jobdone."syncIntents" ("actorUserId", "createdAt" DESC);

CREATE TABLE jobdone."syncActions" (
  id            uuid        PRIMARY KEY,
  "intentId"    uuid        REFERENCES jobdone."syncIntents"(id),
  t             bigint      REFERENCES jobdone."syncTransactions"(t),
  "actorUserId" uuid        NOT NULL,
  "actionType"  text        NOT NULL,
  "ownerKind"   text        NOT NULL CHECK ("ownerKind" IN ('user','team')),
  "ownerId"     uuid        NOT NULL,
  "objectRefs"  jsonb       NOT NULL DEFAULT '[]',
  "stateJson"   jsonb       NOT NULL DEFAULT '{}',
  "resultJson"  jsonb       NOT NULL DEFAULT '{}',
  status        text        NOT NULL CHECK (status IN ('accepted','rejected','conflict')),
  "createdAt"   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX syncActions_actor_created_idx
  ON jobdone."syncActions" ("actorUserId", "createdAt" DESC);
CREATE INDEX syncActions_owner_created_idx
  ON jobdone."syncActions" ("ownerKind", "ownerId", "createdAt" DESC);
CREATE INDEX syncActions_transaction_idx
  ON jobdone."syncActions" (t);

CREATE TABLE jobdone."outboxEffects" (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  t               bigint      NOT NULL REFERENCES jobdone."syncTransactions"(t),
  "effectType"    text        NOT NULL,
  "ownerKind"     text        NOT NULL CHECK ("ownerKind" IN ('user','team')),
  "ownerId"       uuid        NOT NULL,
  "objectRefs"    jsonb       NOT NULL DEFAULT '[]',
  "effectJson"    jsonb       NOT NULL,
  status          text        NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','running','succeeded','failed','dead')),
  attempts        integer     NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  "nextAttemptAt" timestamptz NOT NULL DEFAULT now(),
  "createdAt"     timestamptz NOT NULL DEFAULT now(),
  "updatedAt"     timestamptz NOT NULL DEFAULT now(),
  "lastError"     text
);

CREATE INDEX outboxEffects_due_idx
  ON jobdone."outboxEffects" ("nextAttemptAt", "createdAt")
  WHERE status IN ('queued','failed');
CREATE INDEX outboxEffects_transaction_idx
  ON jobdone."outboxEffects" (t);

CREATE TABLE jobdone."opsEvents" (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  "requestId"     text        NOT NULL,
  severity        text        NOT NULL CHECK (severity IN ('info','warning','error','critical')),
  source          text        NOT NULL,
  kind            text        NOT NULL,
  action          text,
  "ownerKind"     text        CHECK ("ownerKind" IS NULL OR "ownerKind" IN ('user','team')),
  "ownerId"       uuid,
  "objectRefs"    jsonb       NOT NULL DEFAULT '[]',
  retryable       boolean     NOT NULL DEFAULT false,
  "sanitizedJson" jsonb       NOT NULL DEFAULT '{}',
  "createdAt"     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX opsEvents_request_idx
  ON jobdone."opsEvents" ("requestId");
CREATE INDEX opsEvents_created_idx
  ON jobdone."opsEvents" ("createdAt" DESC);
CREATE INDEX opsEvents_severity_created_idx
  ON jobdone."opsEvents" (severity, "createdAt" DESC);

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
