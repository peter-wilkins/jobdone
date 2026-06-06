# Local Replica sync uses collection changes and Server T

JobDone's Local Replica sync protocol will use typed canonical product objects, collection-scoped changes, UUIDv7 Client IDs, and a Datomic-like backend transaction cursor called **Server T**.

The canonical contract is a **Replica Snapshot** object graph, not an HTTP JSON contract. IndexedDB records, API payloads, backend validation, and property tests should converge on the same camelCase JobDone shape. JSON remains the MVP transport codec because it is readable and easy to debug, but it should sit behind a Codec Adapter so a denser production codec can be introduced later without changing product data contracts.

The storage contract should be compatible with a future opaque-payload backend. Sync rows separate readable sync metadata from payload bytes. MVP starts with `codec: json` and `encryptionMode: none`, storing readable JSON for debugging and property testing. The same outer contract should later support encrypted payloads without changing IDs, Server T, tombstones, ACL, or sync cursors.

The first implementation should prefer one generic `syncObjects` table over one physical table per collection. `syncObjects` stores owner scope, collection name, transaction facts, codec/encryption metadata, and payload. This should reduce frontend/backend churn when product objects evolve: most shape changes stay inside shared contracts, local materializers, and property tests rather than requiring backend table rewrites. Typed SQL views or derived indexes can be added later only for proven server-side query needs.

MVP server-side indexes should support sync correctness and idempotency first: owner/collection/change-cursor lookup, unique object identity per owner and collection, and optional payload hashes. Product querying such as Recall, map search, contact lookup, and Team backlog filtering should run against the frontend materialized local store first. Server-side derived indexes can be added later when local querying is insufficient or when a user opts into server-readable features.

Sync object ownership uses `ownerKind` and `ownerId`. Personal objects use `ownerKind: user` with the authenticated user's ID. Team objects use `ownerKind: team` with the Team ID. Owner scope remains explicit rather than inferred through parent links.

If phones later prove too weak for a complex query or analysis, JobDone may add an optional compute service that receives depersonalised or user-consented data, performs the expensive work, and returns results to the phone. That service should not become a hidden dependency of normal sync.

## Decision

Syncable app-facing rows use UUIDv7 Client IDs. Backend server IDs may exist only as private implementation details and must not leak through app-facing contracts.

The backend owns sync ordering through a first-class `syncTransactions` table. Each committed backend transaction receives a monotonic `t` value. Local Replica pulls use Server T as the cursor instead of `updatedAt` or device timestamps.

Sync payloads are collection changes, not a public append-only event log. Pull responses group upserts and tombstones by collection. Property tests should be able to generate a Replica Snapshot, store it through one side of the system, sync it, and compare set properties on the resulting Replica Snapshot.

Rows use transaction facts:

- Sync rows carry `id`, `createdT`, `createdAt`, `changedT`, `changedAt`, `deletedT`, and `deletedAt`.
- `changedT` is the latest committed transaction that changed the object, including creation, mutation, or tombstone.
- `changedAt` is diagnostic/display time only. Pull correctness uses `changedT`, not timestamps.

`changedT` keeps the generic storage contract simple: pull and pagination can use one object-level change cursor instead of deciding whether a row was created, updated, or deleted. Immutable collections still reject payload mutations, but their `changedT` may equal `createdT` or `deletedT`.

The first `syncObjects` contract is:

- `id` UUID, the UUIDv7 Client ID
- `ownerKind`, such as `user` or `team`
- `ownerId` UUID
- `collection` text
- `createdT`, `changedT`, `deletedT`
- `createdAt`, `changedAt`, `deletedAt`
- `codec`, initially `json`
- `encryptionMode`, initially `none`
- `payloadJson` for readable MVP payloads
- `payloadBytes` for future encoded/encrypted payloads
- `payloadHash`
- `schemaVersion`

Object rows carry owner scope. `syncTransactions` carry actor identity.

The first `syncTransactions` contract is:

- `t` bigint, monotonic transaction number
- `replicaEpoch` UUID
- `actorUserId` UUID, nullable for system work
- `actorEmail` text, nullable
- `actorDeviceId` text, nullable
- `source`, such as `syncPush`, `system`, `import`, or `repair`
- `createdAt` backend commit timestamp

Idempotency belongs to Sync Intents rather than Sync Transactions.

The first pull API should pull every collection needed for the frontend to function across all owner scopes the authenticated user may access. The client should not need to list collections in the request. The server derives allowed user and Team scopes from authentication and membership, then returns changes since the requested Server T.

The first pull request shape is `replicaEpoch`, `sinceT`, and optional page limit. The response returns `replicaEpoch`, `fromT`, `toT`, `hasMore`, and `objects`.

MVP pull should use pagination rather than streaming. The first page chooses a stable upper bound `toT`; subsequent pages continue fetching changes where `sinceT < changeT <= toT`. New writes after that upper bound wait for the next pull. Pagination is easier to retry, test, and apply to IndexedDB than streamed partial responses.

The first push API sends `replicaEpoch`, `baseT`, and an ordered list of Sync Intents. A Sync Intent carries a UUIDv7 idempotency key, owner scope, collection, action, object ID, optional base object transaction for conflict checks, payload, and createdAt. The response returns intent results plus the Sync Objects needed to reconcile the local replica.

Normal creates, edits, deletes, and Team actions should all flow through Sync Intents. Personal Entry creation and Team Backlog claiming use the same sync pipeline; the difference is policy. Personal immutable creates are usually accepted, while Team actions may require trust-mode, ownership, or race checks.

Generic upsert/delete conflict handling follows compare-and-set rules. Missing object plus upsert creates. Existing mutable object can update or delete when `baseObjectT` matches the current object transaction. Stale `baseObjectT` conflicts and returns the current object. Immutable collections reject different payloads for an existing ID, but can treat same-ID same-hash retries as idempotent success.

Business-rule actions should be named Sync Intent actions rather than generic object edits. Team claims, approval submissions, approval decisions, evidence requests, and Team Invite acceptance have policy and race semantics that should be explicit and property-testable. Generic `upsertObject` and `deleteObject` remain useful for ordinary personal or high-trust mutable objects.

The frontend should keep materialized per-collection IndexedDB stores for UI reads. Generic sync does not mean screens parse opaque blobs directly. The local sync layer keeps a `syncObjectsLocal` ledger/cache, `syncIntentsLocal`, and `replicaState`; materializers validate each Sync Object's collection schema and update stores such as Entries, Contacts, Locations, and Team Backlog Items.

For UI purposes, materialized collection stores are the local source of truth. `syncObjectsLocal` is the sync ledger/cache. Local writes create Sync Intents and optimistically update materialized stores; backend reconciliation updates the sync ledger and materialized stores.

Optimistic UI depends on action risk. Personal immutable creates are fully optimistic. Personal mutable edits and High Trust Team edits can be optimistic with compare-and-set rollback on conflict. Low Trust Team restricted edits should not show controls unless allowed; if the app is offline and uncertain, the intent can queue but must appear pending rather than accepted. Race actions such as claiming a Backlog Item can appear optimistic but should remain visibly pending until accepted, with friendly conflict copy if rejected.

For MVP, the sync adapter may protect push/pull correctness with a Postgres advisory lock or another explicit serialization mechanism. Correctness is more important than write throughput while JobDone has no real users.

While reshaping the schema, staging may use a temporary `jobdone_next` schema. `jobdone_next` exists only to build and test the clean Local Replica contract without fighting deployed v1 tables. Once schema contracts and property tests are green, the final schema remains `jobdone`; old v1 tables and the temporary schema should be deleted rather than kept as long-term compatibility layers.

## Mutable Collections

Mutable collections include Contacts, Locations, Teams, Team Members, Team Invites, Backlog Items, and Approval Requests. Tag Categories and Tags are deliberately not in the first sync contract slice because Tags may be reduced or replaced by more precise User-Defined Context Clues.

Immutable collections include Entries, Entry Contacts, Entry Locations, Entry Attachments, Queries, and Sync Intents. Entry Tags are deferred with the Tag model. Feedback and crash reports are outside the normal Local Replica contract unless a later user-facing feedback history needs them.

Captures stay local-only before Confirmation and are not part of Replica Snapshot sync.

Current inferred/debug Context Clues are not part of the first personal replica sync slice. They are too noisy and unstable to treat as durable user data. A later slice should split durable user-confirmed or User-Defined Context Clues from disposable prediction/debug evidence before syncing them.

The first Entry replica contract uses a single durable `text` field for the confirmed user-visible Entry body. `summary` and `transcript` are voice-era or Capture-layer concepts and should not be the final Entry contract.

The final Entry replica contract should not carry `captureId`. Captures are local-only before Confirmation; after Confirmation the Entry `id` and Sync Intent idempotency key are the durable identities.

The first Contact replica contract should preserve imported phone Contacts as raw `vcardText` plus parsed fields JobDone currently understands. This keeps vCard/VCF import/export simple and avoids losing contact details that the current UI does not model yet.

A future end-to-end encryption model may treat the backend as an encrypted sync store and move querying to the frontend peer. In that model, outer sync metadata such as IDs, owner scope, transaction facts, tombstones, and perhaps collection names remain readable, while privacy-sensitive payload fields such as Entry text, Contact vCard data, Location labels/coordinates, and Photos can be encrypted unless the user opts into server-readable improvement/debug features. This needs a separate ADR before implementation.

Postgres remains the MVP implementation because Supabase Auth, SQL debugging, and deployment are already in place. The protocol should not assume Postgres-specific row semantics for payload data, so a future ordered transactional key-value implementation such as FoundationDB remains plausible if scale, enterprise privacy, or operational needs justify it.

## Alternatives

Using `updatedAt > lastSync` was rejected because device clocks and wall-clock ordering are not reliable enough for sync correctness.

Using a public append-only event log was rejected for MVP because the app needs current state quickly, and rebuilding state in every client would complicate IndexedDB and property testing. JobDone can still keep immutable domain facts and tombstones, and can add event/audit tables later if the product needs them.

Adopting a full local-first sync product such as Replicache, Zero, Electric, PowerSync, RxDB, or WatermelonDB was deferred. Their ideas are useful, especially optimistic local writes, mutation IDs, pull cookies, schema versions, and scoped shapes, but taking a dependency now would be a rewrite before the sync contract itself is proven.

## Consequences

CI should include schema conformance checks for JobDone-owned tables: `jobdone` schema only, camelCase identifiers for JobDone data, UUID owner IDs, UUID syncable IDs, required transaction fields for syncable rows, scoped association FKs, RLS enabled, and no `remoteId` or backend server IDs in app-facing contracts.

Schema checks should support explicit modes. During MVP, `mvp-clean` mode checks contract shape and allows destructive clean resets. Once JobDone enters user-preserving safety mode, schema CI should add nondestructive/backwards-compatibility checks such as rejecting table drops, column drops, incompatible type changes, unsafe not-null changes, and unvalidated constraints unless a deliberate migration plan and backup path exist.

Property tests should be split at useful boundaries:

- contract and schema conformance
- backend API plus real Postgres
- IndexedDB plus frontend sync adapter
- later, a full app wake-up sync harness without Playwright button pushing

These tests should prove preservation of IDs, associations, tombstones, transaction ordering, and no cross-user or cross-team leakage.
