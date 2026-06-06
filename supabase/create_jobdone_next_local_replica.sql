-- JobDone Local Replica scratch schema.
--
-- MVP/destructive by design:
--   psql "$JOBDONE_STAGING_SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f supabase/create_jobdone_next_local_replica.sql
--
-- `jobdone_next` is temporary. Build and test the generic Local Replica
-- contract here, then replace final `jobdone` when property tests are green.

DROP SCHEMA IF EXISTS jobdone_next CASCADE;
CREATE SCHEMA jobdone_next;
SET search_path = jobdone_next, public;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'jobdone_backend') THEN
    CREATE ROLE jobdone_backend NOLOGIN;
  END IF;
END;
$$;

CREATE TABLE "syncTransactions" (
  "t"             BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  "replicaEpoch" UUID NOT NULL,
  "actorUserId"  UUID,
  "actorEmail"   TEXT,
  "actorDeviceId" TEXT,
  "source"       TEXT NOT NULL
                 CHECK ("source" IN ('syncPush', 'system', 'import', 'repair')),
  "createdAt"    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK ("actorEmail" IS NULL OR btrim("actorEmail") <> ''),
  CHECK ("actorDeviceId" IS NULL OR btrim("actorDeviceId") <> '')
);

CREATE INDEX "syncTransactionsReplicaTIdx"
  ON "syncTransactions"("replicaEpoch", "t");

CREATE INDEX "syncTransactionsActorUserTIdx"
  ON "syncTransactions"("actorUserId", "t")
  WHERE "actorUserId" IS NOT NULL;

CREATE TABLE "syncOwnerAccess" (
  "id"         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "ownerKind" TEXT NOT NULL CHECK ("ownerKind" IN ('user', 'team')),
  "ownerId"   UUID NOT NULL,
  "userId"    UUID NOT NULL,
  "role"      TEXT NOT NULL CHECK ("role" IN ('owner', 'member', 'worker', 'viewer')),
  "createdT"  BIGINT NOT NULL REFERENCES "syncTransactions"("t"),
  "revokedT"  BIGINT REFERENCES "syncTransactions"("t"),
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "revokedAt" TIMESTAMPTZ,
  CHECK ("revokedT" IS NULL OR "revokedT" >= "createdT"),
  CHECK (("revokedT" IS NULL AND "revokedAt" IS NULL) OR ("revokedT" IS NOT NULL AND "revokedAt" IS NOT NULL))
);

CREATE UNIQUE INDEX "syncOwnerAccessActiveUidx"
  ON "syncOwnerAccess"("ownerKind", "ownerId", "userId")
  WHERE "revokedT" IS NULL;

CREATE INDEX "syncOwnerAccessUserOwnerIdx"
  ON "syncOwnerAccess"("userId", "ownerKind", "ownerId")
  WHERE "revokedT" IS NULL;

CREATE INDEX "syncOwnerAccessOwnerIdx"
  ON "syncOwnerAccess"("ownerKind", "ownerId", "role")
  WHERE "revokedT" IS NULL;

CREATE TABLE "syncObjects" (
  "id"             UUID NOT NULL,
  "ownerKind"      TEXT NOT NULL CHECK ("ownerKind" IN ('user', 'team')),
  "ownerId"        UUID NOT NULL,
  "collection"     TEXT NOT NULL CHECK ("collection" ~ '^[a-z][A-Za-z0-9]*$'),
  "createdT"       BIGINT NOT NULL REFERENCES "syncTransactions"("t"),
  "changedT"       BIGINT NOT NULL REFERENCES "syncTransactions"("t"),
  "deletedT"       BIGINT REFERENCES "syncTransactions"("t"),
  "createdAt"      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "changedAt"      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "deletedAt"      TIMESTAMPTZ,
  "codec"          TEXT NOT NULL DEFAULT 'json' CHECK ("codec" IN ('json')),
  "encryptionMode" TEXT NOT NULL DEFAULT 'none' CHECK ("encryptionMode" IN ('none')),
  "payloadJson"    JSONB NOT NULL,
  "payloadBytes"   BYTEA,
  "payloadHash"    TEXT NOT NULL CHECK (btrim("payloadHash") <> ''),
  "schemaVersion"  INTEGER NOT NULL CHECK ("schemaVersion" > 0),
  PRIMARY KEY ("ownerKind", "ownerId", "collection", "id"),
  CHECK ("changedT" >= "createdT"),
  CHECK ("deletedT" IS NULL OR "deletedT" >= "changedT"),
  CHECK (("deletedT" IS NULL AND "deletedAt" IS NULL) OR ("deletedT" IS NOT NULL AND "deletedAt" IS NOT NULL)),
  CHECK ("payloadBytes" IS NULL)
);

CREATE INDEX "syncObjectsOwnerChangedIdx"
  ON "syncObjects"("ownerKind", "ownerId", "changedT");

CREATE INDEX "syncObjectsOwnerCollectionChangedIdx"
  ON "syncObjects"("ownerKind", "ownerId", "collection", "changedT");

CREATE INDEX "syncObjectsPayloadHashIdx"
  ON "syncObjects"("ownerKind", "ownerId", "collection", "payloadHash");

CREATE INDEX "syncObjectsDeletedIdx"
  ON "syncObjects"("ownerKind", "ownerId", "deletedT")
  WHERE "deletedT" IS NOT NULL;

CREATE TABLE "syncIntents" (
  "id"            UUID PRIMARY KEY,
  "replicaEpoch" UUID NOT NULL,
  "baseT"         BIGINT NOT NULL,
  "actorUserId"  UUID NOT NULL,
  "actorDeviceId" TEXT,
  "ownerKind"     TEXT NOT NULL CHECK ("ownerKind" IN ('user', 'team')),
  "ownerId"       UUID NOT NULL,
  "collection"    TEXT NOT NULL CHECK ("collection" ~ '^[a-z][A-Za-z0-9]*$'),
  "action"        TEXT NOT NULL CHECK ("action" ~ '^[a-z][A-Za-z0-9]*$'),
  "objectId"      UUID,
  "baseObjectT"   BIGINT,
  "payloadJson"   JSONB NOT NULL DEFAULT '{}'::jsonb,
  "payloadHash"   TEXT,
  "status"        TEXT NOT NULL DEFAULT 'pending'
                  CHECK ("status" IN ('pending', 'accepted', 'idempotent', 'conflict', 'rejected')),
  "resultJson"    JSONB NOT NULL DEFAULT '{}'::jsonb,
  "committedT"    BIGINT REFERENCES "syncTransactions"("t"),
  "createdAt"     TIMESTAMPTZ NOT NULL,
  "receivedAt"    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK ("baseObjectT" IS NULL OR "baseObjectT" >= 0),
  CHECK ("committedT" IS NULL OR "committedT" >= "baseT"),
  CHECK ("payloadHash" IS NULL OR btrim("payloadHash") <> '')
);

CREATE INDEX "syncIntentsActorReceivedIdx"
  ON "syncIntents"("actorUserId", "receivedAt" DESC);

CREATE INDEX "syncIntentsOwnerStatusIdx"
  ON "syncIntents"("ownerKind", "ownerId", "status");

CREATE INDEX "syncIntentsCommittedTIdx"
  ON "syncIntents"("committedT")
  WHERE "committedT" IS NOT NULL;

ALTER TABLE "syncTransactions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "syncOwnerAccess" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "syncObjects" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "syncIntents" ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE
  target_table TEXT;
BEGIN
  FOREACH target_table IN ARRAY ARRAY[
    'syncTransactions',
    'syncOwnerAccess',
    'syncObjects',
    'syncIntents'
  ]
  LOOP
    EXECUTE format(
      'CREATE POLICY %I ON %I.%I FOR ALL USING (false) WITH CHECK (false)',
      'deny_all_direct_access',
      'jobdone_next',
      target_table
    );

    EXECUTE format(
      'CREATE POLICY %I ON %I.%I FOR ALL TO %I USING (true) WITH CHECK (true)',
      'backend_direct_access',
      'jobdone_next',
      target_table,
      'jobdone_backend'
    );
  END LOOP;
END;
$$;

REVOKE ALL ON SCHEMA jobdone_next FROM PUBLIC, anon, authenticated;
GRANT USAGE ON SCHEMA jobdone_next TO service_role;
GRANT USAGE ON SCHEMA jobdone_next TO jobdone_backend;

REVOKE ALL ON ALL TABLES IN SCHEMA jobdone_next FROM PUBLIC, anon, authenticated;
GRANT ALL ON ALL TABLES IN SCHEMA jobdone_next TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA jobdone_next TO jobdone_backend;

REVOKE ALL ON ALL SEQUENCES IN SCHEMA jobdone_next FROM PUBLIC, anon, authenticated;
GRANT ALL ON ALL SEQUENCES IN SCHEMA jobdone_next TO service_role;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA jobdone_next TO jobdone_backend;

ALTER DEFAULT PRIVILEGES IN SCHEMA jobdone_next
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO jobdone_backend;

ALTER DEFAULT PRIVILEGES IN SCHEMA jobdone_next
  GRANT USAGE, SELECT ON SEQUENCES TO jobdone_backend;
