SET search_path = jobdone, extensions, public;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'jobdone_backend') THEN
    CREATE ROLE jobdone_backend NOLOGIN;
  END IF;
END;
$$;

CREATE TABLE IF NOT EXISTS teams (
  id                                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name                              TEXT NOT NULL,
  template                          TEXT NOT NULL DEFAULT 'high_trust'
                                    CHECK (template IN ('high_trust', 'low_trust', 'family')),
  points_enabled                    BOOLEAN NOT NULL DEFAULT FALSE,
  approval_mode                     TEXT NOT NULL DEFAULT 'auto'
                                    CHECK (approval_mode IN ('auto', 'manual')),
  workers_can_create_backlog_items  BOOLEAN NOT NULL DEFAULT TRUE,
  require_owner_self_review         BOOLEAN NOT NULL DEFAULT FALSE,
  created_at                        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS teams_created_at_idx ON teams(created_at ASC);

CREATE TABLE IF NOT EXISTS team_members (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id          UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  email            TEXT NOT NULL,
  normalized_email TEXT GENERATED ALWAYS AS (lower(btrim(email))) STORED,
  role             TEXT NOT NULL DEFAULT 'worker'
                   CHECK (role IN ('owner', 'worker')),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS team_members_team_id_idx ON team_members(team_id);
CREATE INDEX IF NOT EXISTS team_members_normalized_email_idx ON team_members(normalized_email);
CREATE UNIQUE INDEX IF NOT EXISTS team_members_team_email_uidx ON team_members(team_id, normalized_email);

CREATE TABLE IF NOT EXISTS team_invites (
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

CREATE INDEX IF NOT EXISTS team_invites_team_id_idx ON team_invites(team_id);
CREATE INDEX IF NOT EXISTS team_invites_normalized_email_idx ON team_invites(normalized_email);
CREATE INDEX IF NOT EXISTS team_invites_token_hash_idx ON team_invites(token_hash);
CREATE INDEX IF NOT EXISTS team_invites_invited_by_created_idx ON team_invites(invited_by_email, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS team_invites_team_pending_email_uidx
  ON team_invites(team_id, normalized_email)
  WHERE status = 'pending';

CREATE TABLE IF NOT EXISTS backlog_items (
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

CREATE INDEX IF NOT EXISTS backlog_items_team_status_idx ON backlog_items(team_id, status);
CREATE INDEX IF NOT EXISTS backlog_items_claimed_by_email_idx ON backlog_items(claimed_by_email);
CREATE INDEX IF NOT EXISTS backlog_items_created_at_idx ON backlog_items(created_at DESC);

CREATE TABLE IF NOT EXISTS approval_requests (
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

CREATE INDEX IF NOT EXISTS approval_requests_team_status_idx ON approval_requests(team_id, status);
CREATE INDEX IF NOT EXISTS approval_requests_backlog_item_idx ON approval_requests(backlog_item_id);
CREATE INDEX IF NOT EXISTS approval_requests_submitted_at_idx ON approval_requests(submitted_at ASC);

ALTER TABLE teams ENABLE ROW LEVEL SECURITY;
ALTER TABLE team_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE team_invites ENABLE ROW LEVEL SECURITY;
ALTER TABLE backlog_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE approval_requests ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE
  target_table TEXT;
BEGIN
  FOREACH target_table IN ARRAY ARRAY['teams', 'team_members', 'team_invites', 'backlog_items', 'approval_requests']
  LOOP
    IF NOT EXISTS (
      SELECT 1
      FROM pg_policies
      WHERE schemaname = 'jobdone'
        AND tablename = target_table
        AND policyname = 'deny_all_direct_access'
    ) THEN
      EXECUTE format(
        'CREATE POLICY %I ON %I.%I FOR ALL USING (false) WITH CHECK (false)',
        'deny_all_direct_access',
        'jobdone',
        target_table
      );
    END IF;

    IF NOT EXISTS (
      SELECT 1
      FROM pg_policies
      WHERE schemaname = 'jobdone'
        AND tablename = target_table
        AND policyname = 'backend_direct_access'
    ) THEN
      EXECUTE format(
        'CREATE POLICY %I ON %I.%I FOR ALL TO %I USING (true) WITH CHECK (true)',
        'backend_direct_access',
        'jobdone',
        target_table,
        'jobdone_backend'
      );
    END IF;
  END LOOP;
END;
$$;

REVOKE ALL ON teams, team_members, team_invites, backlog_items, approval_requests FROM PUBLIC, anon, authenticated;
GRANT ALL ON teams, team_members, team_invites, backlog_items, approval_requests TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON teams, team_members, team_invites, backlog_items, approval_requests TO jobdone_backend;
