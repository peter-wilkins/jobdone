-- Local Replica sync schema proposal
-- Incorporates Hickey decomplex review decisions (2026-06-10)
--
-- Changes from ADR-0010 first-cut:
--   1. payloadMeta JSONB replaces flat codec/encryptionMode/schemaVersion fields
--   2. syncTransactions is ordering-only; actor identity is a separate optional table
--   3. SyncIntent envelope fields (id, replicaEpoch, baseT) are wire-only; not stored flat
--   4. syncOwnerAccess is capability-grant rows, not a single "has access" record
--   5. replicaEpoch removed from syncObjects rows; lives only in request/response envelopes

-- ---------------------------------------------------------------------------
-- syncTransactions
-- Owns sync ordering only. Safety-critical — never mutated after insert.
-- Actor identity is in syncTransactionActors (separate, erasable).
-- ---------------------------------------------------------------------------
CREATE TABLE jobdone.syncTransactions (
  t             bigint      PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  source        text        NOT NULL CHECK (source IN ('syncPush','system','import','repair')),
  createdAt     timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- syncTransactionActors
-- Optional audit rows linked to a transaction.
-- GDPR erasure: DELETE rows here; syncTransactions rows are untouched.
-- ---------------------------------------------------------------------------
CREATE TABLE jobdone.syncTransactionActors (
  t             bigint      PRIMARY KEY REFERENCES jobdone.syncTransactions(t) ON DELETE CASCADE,
  actorUserId   uuid,
  actorEmail    text,
  actorDeviceId text
);

-- ---------------------------------------------------------------------------
-- syncObjects
-- One row per syncable product object.
--
-- payloadMeta replaces flat codec/encryptionMode/schemaVersion:
--   MVP:       { "codec": "json", "encryptionMode": "none", "schemaVersion": 1 }
--   Encrypted: { "codec": "json", "encryptionMode": "aes-gcm-256",
--                "schemaVersion": 1, "keyId": "...", "algorithm": "...", "nonce": "..." }
--
-- No replicaEpoch column — epoch is a request/response envelope concern only.
-- ---------------------------------------------------------------------------
CREATE TABLE jobdone.syncObjects (
  id              uuid        NOT NULL,              -- UUIDv7 Client ID
  ownerKind       text        NOT NULL CHECK (ownerKind IN ('user','team')),
  ownerId         uuid        NOT NULL,
  collection      text        NOT NULL,
  createdT        bigint      NOT NULL REFERENCES jobdone.syncTransactions(t),
  changedT        bigint      NOT NULL REFERENCES jobdone.syncTransactions(t),
  deletedT        bigint               REFERENCES jobdone.syncTransactions(t),
  createdAt       timestamptz NOT NULL DEFAULT now(),
  changedAt       timestamptz NOT NULL DEFAULT now(),
  deletedAt       timestamptz,
  payloadMeta     jsonb       NOT NULL DEFAULT '{"codec":"json","encryptionMode":"none","schemaVersion":1}',
  payloadJson     jsonb,                             -- readable MVP payloads
  payloadBytes    bytea,                             -- future encoded/encrypted payloads
  payloadHash     text,
  PRIMARY KEY (id, ownerKind, ownerId)
);

CREATE UNIQUE INDEX syncObjects_owner_collection_id_uidx
  ON jobdone.syncObjects (ownerKind, ownerId, collection, id);

CREATE INDEX syncObjects_owner_changedT_idx
  ON jobdone.syncObjects (ownerKind, ownerId, changedT DESC)
  WHERE deletedT IS NULL;

-- ---------------------------------------------------------------------------
-- syncOwnerAccess
-- One row per capability grant. Replaces a single "has access" boolean.
--
-- capability: 'pull' | 'push' | 'readable_access'
--   pull + push auto-created for personal scope on account creation.
--   readable_access added when Keybag is set up (future E2EE).
--
-- Revocation: set revokedAt — do not delete rows.
-- GDPR erasure: delete all rows for userId — does not touch Team data.
-- ---------------------------------------------------------------------------
CREATE TABLE jobdone.syncOwnerAccess (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  userId      uuid        NOT NULL,
  ownerKind   text        NOT NULL CHECK (ownerKind IN ('user','team')),
  ownerId     uuid        NOT NULL,
  capability  text        NOT NULL CHECK (capability IN ('pull','push','readable_access')),
  grantedAt   timestamptz NOT NULL DEFAULT now(),
  revokedAt   timestamptz
);

CREATE UNIQUE INDEX syncOwnerAccess_active_uidx
  ON jobdone.syncOwnerAccess (userId, ownerKind, ownerId, capability)
  WHERE revokedAt IS NULL;

CREATE INDEX syncOwnerAccess_owner_idx
  ON jobdone.syncOwnerAccess (ownerKind, ownerId)
  WHERE revokedAt IS NULL;

-- ---------------------------------------------------------------------------
-- syncIntents
-- Idempotency ledger for push retries.
-- Stores envelope identity + intent hash only — not the full parsed action.
-- The SyncIntent business payload is in payloadJson/payloadHash on syncObjects
-- or returned as intent results; it is not re-parsed here for dedup.
--
-- Wire format (not stored flat):
--   SyncEnvelope { id, replicaEpoch, baseT, createdAt }   <- retry plumbing
--   SyncIntent   { action, ownerKind, ownerId, collection, objectId, payloadJson }
-- ---------------------------------------------------------------------------
CREATE TABLE jobdone.syncIntents (
  id              uuid        PRIMARY KEY,           -- UUIDv7 idempotency key
  actorUserId     uuid        NOT NULL,
  intentHash      text        NOT NULL,              -- hash of action+objectId+payloadHash
  status          text        NOT NULL CHECK (status IN ('accepted','rejected','conflict')),
  resultT         bigint      REFERENCES jobdone.syncTransactions(t),
  createdAt       timestamptz NOT NULL DEFAULT now(),
  resolvedAt      timestamptz
);

CREATE INDEX syncIntents_actor_created_idx
  ON jobdone.syncIntents (actorUserId, createdAt DESC);

-- ---------------------------------------------------------------------------
-- Permissions (same pattern as existing tables)
-- ---------------------------------------------------------------------------
GRANT SELECT, INSERT, UPDATE ON jobdone.syncTransactions        TO jobdone_backend;
GRANT SELECT, INSERT, UPDATE ON jobdone.syncTransactionActors   TO jobdone_backend;
GRANT SELECT, INSERT, UPDATE, DELETE ON jobdone.syncObjects     TO jobdone_backend;
GRANT SELECT, INSERT, UPDATE ON jobdone.syncOwnerAccess         TO jobdone_backend;
GRANT SELECT, INSERT, UPDATE ON jobdone.syncIntents             TO jobdone_backend;

ALTER TABLE jobdone.syncTransactions        ENABLE ROW LEVEL SECURITY;
ALTER TABLE jobdone.syncTransactionActors   ENABLE ROW LEVEL SECURITY;
ALTER TABLE jobdone.syncObjects             ENABLE ROW LEVEL SECURITY;
ALTER TABLE jobdone.syncOwnerAccess         ENABLE ROW LEVEL SECURITY;
ALTER TABLE jobdone.syncIntents             ENABLE ROW LEVEL SECURITY;

CREATE POLICY backend_direct_access ON jobdone.syncTransactions
  TO jobdone_backend USING (true) WITH CHECK (true);
CREATE POLICY backend_direct_access ON jobdone.syncTransactionActors
  TO jobdone_backend USING (true) WITH CHECK (true);
CREATE POLICY backend_direct_access ON jobdone.syncObjects
  TO jobdone_backend USING (true) WITH CHECK (true);
CREATE POLICY backend_direct_access ON jobdone.syncOwnerAccess
  TO jobdone_backend USING (true) WITH CHECK (true);
CREATE POLICY backend_direct_access ON jobdone.syncIntents
  TO jobdone_backend USING (true) WITH CHECK (true);
