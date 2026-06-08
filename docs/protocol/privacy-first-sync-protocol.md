# Privacy-First Sync Protocol

Status: draft 0, extracted from JobDone Local Replica design.

This is not yet a standard. It is a small protocol shape for applications that want local-first sync while treating the backend as infrastructure, not as a trusted reader of user content.

## Problem

Many apps need the same basic loop:

- work instantly on one device
- survive offline use
- sync across devices
- support sharing with other people
- recover after device loss or browser storage eviction
- keep private content unreadable by the sync provider

Generic cloud databases solve sync but normally see the app data. End-to-end encrypted apps solve privacy, but often bake the sync model into one product, one document format, or one collaboration model.

This protocol aims at a narrower middle ground: typed app data, local materialization, coarse backend restore metadata, encrypted payloads, and explicit coverage reporting.

## Core Idea

The client owns the user experience and the private data graph.

The server owns:

- authentication and authorization
- durable storage
- idempotent write acceptance
- transaction ordering
- coarse restore partitions
- sync cursors

The server must not need to read private payload content or private relationships between app objects.

## Concepts

**Replica Snapshot**

The typed app object graph after local materialization. It is the product-level contract. JSON, CBOR, SQL rows, HTTP, and IndexedDB records are implementation details around this shape.

**Client ID**

The durable app-facing object identity, preferably UUIDv7. Backend implementation IDs may exist, but must not leak into app contracts.

**Sync Intent**

A locally recorded action that may need backend acceptance: create object, update object, delete/tombstone object, claim work, accept invite, submit evidence. Intents carry idempotency keys so retries are safe.

**Sync Transaction**

A backend commit that accepts one or more Sync Intents and assigns one monotonic transaction number.

**Server T**

The monotonic transaction cursor used for pulls. Pull correctness depends on Server T, not device clocks or `updatedAt`.

**Sync Object**

The server-stored record for one syncable object. It contains readable sync metadata plus payload bytes. In debug/MVP mode the payload can be readable JSON; in encrypted mode the payload is ciphertext.

**Sync Partition**

A coarse backend-readable bucket used for restore: owner scope, collection, Server T range, broad time bucket, payload kind, payload size, tombstone state. Sync Partitions are not search partitions.

**Encrypted Payload Mode**

Payloads are encrypted on the client. The backend can store, order, authorize, and return them, but cannot inspect app content.

**Keybag**

Wrapped access records that let an authorized user, device, or credential unlock a Data Key. Sharing a team grants access to the team Data Key instead of re-encrypting every object.

**Private Relationship Graph**

The graph connecting entries to contacts, locations, work contexts, tasks, and other clues. Opaque IDs still leak repeated use patterns, so relationships should live inside encrypted payloads or local derived indexes by default.

**Coverage**

The local replica's statement about what it can answer. Search/recall must not pretend it has searched all data when older partitions are still restoring.

## Basic Flow

1. User acts locally.
2. Client records a Sync Intent.
3. Client updates local materialized stores optimistically when safe.
4. Client pushes pending intents.
5. Server validates policy and idempotency.
6. Server commits accepted intents into a Sync Transaction.
7. Server returns changed Sync Objects and a new Server T.
8. Client stores the sync ledger and rematerializes typed local stores.
9. Queries run locally against the materialized, decrypted replica.

## Pull Shape

The exact transport can vary, but the logical request is:

```json
{
  "replicaEpoch": "uuid",
  "sinceT": 123,
  "limit": 500
}
```

The logical response is:

```json
{
  "replicaEpoch": "uuid",
  "fromT": 123,
  "toT": 130,
  "hasMore": false,
  "objects": [],
  "coverage": []
}
```

For cold restore, a client may request or receive coarse Sync Partitions first, then hydrate recent text payloads before older history or large attachments.

## Push Shape

The logical request is:

```json
{
  "replicaEpoch": "uuid",
  "baseT": 123,
  "intents": []
}
```

The logical response is:

```json
{
  "replicaEpoch": "uuid",
  "toT": 130,
  "intentResults": [],
  "objects": []
}
```

Conflict and policy failures are intent results, not silent data loss.

## Privacy Rules

Readable by default:

- owner scope
- collection
- object ID
- Server T facts
- tombstone state
- payload hash
- payload kind and approximate size
- coarse time bucket
- access metadata

Encrypted by default:

- entry text
- contact details and vCards
- location names, addresses, and coordinates
- attachment bodies
- private context clue links
- local search text and semantic indexes

Optional/opt-in:

- server-readable diagnostics
- server-side AI features
- server-side search indexes
- depersonalised compute jobs
- server-readable Team Recall for large self-hosted or enterprise-controlled teams

## E2EE Design Lessons

The protocol should steal proven ideas from existing encrypted sync systems without copying their whole product shape:

- Scope-first encryption: one Data Key per owner scope, with sharing implemented by granting key access rather than re-encrypting every object.
- Encrypted type or partition tokens can help fetch coarse buckets without revealing plaintext names, but they still leak equality and should not represent contacts, locations, tasks, or private graph edges by default.
- Keep a global correctness cursor such as Server T, but allow scoped/partition coverage so restore can be efficient.
- Treat coverage as product-critical: local search must know whether it has all searchable data before returning an empty result.
- Keep the private relationship graph encrypted/local by default. Opaque IDs are not enough because repeated IDs leak usage patterns.
- Treat group key epochs, key rotation, forward secrecy, and post-compromise recovery as serious later design work. Use established cryptographic standards and libraries rather than inventing crypto.
- Be honest about revocation: it stops future access, but it cannot erase data already decrypted on another device.
- Keep auth and encrypted-data unlock separate so the protocol is not locked to passwords, magic links, OAuth, or passkeys.
- Envelope every encrypted payload with boring migration metadata: `schemaVersion`, `codec`, `encryptionMode`, `keyId`, `algorithm`, `nonce`, and `payloadHash`.
- Local-first does not forbid server-readable modes, but they must be explicit opt-ins.

## Coverage Rules

Local queries should expose coverage state:

- `complete`: all required searchable partitions are present.
- `partialRestoring`: local results are available, but older or larger partitions are still hydrating.
- `partialFiltered`: user/team/query settings intentionally excluded some partitions.

The important failure to avoid is false completeness: returning "no results" when the local device has not restored enough data to know.

Large Team datasets are the most likely case where complete local restore/search may become too heavy for ordinary devices. The later escape hatch is not silent backend search over encrypted user data. It is an explicit Server-Readable Team Recall mode where a Team chooses self-hosted or enterprise-controlled readable storage/indexing so central Recall can operate over that Team's payloads.

## Implementation Independence

Supabase/Postgres is one implementation. The protocol should also map onto:

- Postgres
- FoundationDB or another ordered transactional key-value store
- Kafka plus compacted state and blob storage
- S3/R2 plus metadata rows
- SQLite-based self-hosted sync

The protocol boundary is not SQL. It is Client IDs, Sync Intents, Server T, Sync Partitions, encrypted payloads, Keybags, coverage, and local materialization.

## Non-Goals

- Replacing messaging encryption standards.
- Hiding all metadata.
- Real-time multiplayer document editing in the first version.
- Global consensus or blockchain-style ordering.
- A generic cloud database clone.

## Research Pointers

Close prior art exists. Any public write-up should be explicit that this is a small protocol shape, not a world-first claim. See [prior-art-survey.md](./prior-art-survey.md).
