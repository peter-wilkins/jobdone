SET search_path = jobdone, extensions, public;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'jobdone_backend') THEN
    CREATE ROLE jobdone_backend NOLOGIN;
  END IF;
END;
$$;

DROP TABLE IF EXISTS entry_locations;
DROP TABLE IF EXISTS locations;

CREATE TABLE locations (
  id                UUID NOT NULL,
  "userId"          TEXT NOT NULL,
  status            TEXT NOT NULL DEFAULT 'active'
                    CHECK (status IN ('active', 'archived', 'confirmed')),
  "displayName"     TEXT NOT NULL,
  "placeText"       TEXT NOT NULL DEFAULT '',
  "addressText"     TEXT NOT NULL DEFAULT '',
  latitude          DOUBLE PRECISION,
  longitude         DOUBLE PRECISION,
  "providerPlaceId" TEXT,
  "contentHash"     TEXT NOT NULL,
  "identityKeys"    TEXT[] NOT NULL DEFAULT '{}',
  "createdAt"       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updatedAt"       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY ("userId", id)
);

CREATE INDEX locations_user_status_updated_idx ON locations("userId", status, "updatedAt" DESC);
CREATE INDEX locations_identity_keys_idx ON locations USING GIN ("identityKeys");

CREATE TABLE entry_locations (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     TEXT NOT NULL,
  entry_id    UUID NOT NULL,
  location_id UUID NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, entry_id, location_id),
  FOREIGN KEY (user_id, location_id) REFERENCES locations("userId", id) ON DELETE CASCADE
);

CREATE INDEX entry_locations_user_entry_idx ON entry_locations(user_id, entry_id);
CREATE INDEX entry_locations_location_idx ON entry_locations(user_id, location_id);

CREATE TABLE IF NOT EXISTS "contactClientAliases" (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "userId"       TEXT NOT NULL,
  collection     TEXT NOT NULL DEFAULT 'contacts',
  "fromClientId" TEXT NOT NULL,
  "toClientId"   TEXT NOT NULL,
  reason         TEXT NOT NULL DEFAULT 'unknown',
  "createdAt"    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

UPDATE "contactClientAliases"
SET collection = 'contacts'
WHERE collection IS NULL OR collection = '';

ALTER TABLE "contactClientAliases"
  ALTER COLUMN collection SET DEFAULT 'contacts',
  ALTER COLUMN collection SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS contact_client_aliases_collection_uidx
  ON "contactClientAliases"("userId", collection, "fromClientId");

ALTER TABLE locations ENABLE ROW LEVEL SECURITY;
ALTER TABLE entry_locations ENABLE ROW LEVEL SECURITY;
ALTER TABLE "contactClientAliases" ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE
  target_table TEXT;
BEGIN
  FOREACH target_table IN ARRAY ARRAY['locations', 'entry_locations', 'contactClientAliases']
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

REVOKE ALL ON locations, entry_locations, "contactClientAliases" FROM PUBLIC, anon, authenticated;
GRANT ALL ON locations, entry_locations, "contactClientAliases" TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON locations, entry_locations, "contactClientAliases" TO jobdone_backend;
