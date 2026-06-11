# Local Replica sync uses collection changes and Server T

JobDone's Local Replica sync protocol will use typed canonical product objects, collection-scoped changes, UUIDv7 Client IDs, and a Datomic-like backend transaction cursor called **Server T**.

This ADR describes a Privacy-First Sync Protocol first and a Supabase/Postgres implementation second. Supabase/Postgres is the MVP backend because it is already deployed with Auth, SQL debugging, and operational familiarity. It is not the protocol boundary. The durable protocol concepts are Client IDs, Sync Intents, Server T, Sync Partitions, encrypted payloads, Keybags, owner access metadata, coverage reporting, and local materialization/querying.

The protocol treats backend infrastructure as ordering, authorization, durability, and coarse restore machinery. It should not require the backend to read private payload content or private Context Clue relationships. A later implementation could use Postgres, FoundationDB, Kafka plus blob storage, R2/S3 plus metadata rows, or another ordered transactional store if that becomes useful.

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

Object rows carry owner scope. `syncTransactions` carry ordering only; actor identity lives in `syncTransactionActors`.

The first `syncTransactions` contract is:

- `t` bigint, monotonic transaction number
- `source`, such as `syncPush`, `system`, `import`, or `repair`
- `createdAt` backend commit timestamp

The first `syncTransactionActors` contract is:

- `t` bigint, one-to-one reference to `syncTransactions`
- `actorUserId` UUID, nullable for system work
- `actorEmail` text, nullable
- `actorDeviceId` text, nullable

Idempotency belongs to Sync Intents rather than Sync Transactions.

The first SQL schema should also include two generic metadata tables:

- `syncOwnerAccess` records which authenticated users may pull or push an owner scope. Personal user scopes can still be derived from the authenticated user, but Team scopes need readable ACL metadata even when payloads later become encrypted.
- `syncIntents` records idempotency keys and accepted/rejected/conflict results for push retries. This is sync plumbing, not a product event log.

These tables are still part of the dumb backend. They are not feature-specific tables; they protect access, idempotency, and retry correctness for every future collection.

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

While reshaping the schema, staging may be wiped and rebuilt from `docs/schema.sql`. The final schema remains `jobdone`; old v1 tables and temporary schemas should be deleted rather than kept as long-term compatibility layers.

## Mutable Collections

Mutable collections include Contacts, Locations, Teams, Team Members, Team Invites, Backlog Items, and Approval Requests. Tag Categories and Tags are deliberately not in the first sync contract slice because Tags may be reduced or replaced by more precise User-Defined Context Clues.

Immutable collections include Entries, Entry Contacts, Entry Locations, Entry Attachments, Queries, and Sync Intents. Entry Tags are deferred with the Tag model. Feedback and crash reports are outside the normal Local Replica contract unless a later user-facing feedback history needs them.

Captures stay local-only before Confirmation and are not part of Replica Snapshot sync.

Current inferred/debug Context Clues are not part of the first personal replica sync slice. They are too noisy and unstable to treat as durable user data. A later slice should split durable user-confirmed or User-Defined Context Clues from disposable prediction/debug evidence before syncing them.

The first Entry replica contract uses a single durable `text` field for the confirmed user-visible Entry body. `summary` and `transcript` are voice-era or Capture-layer concepts and should not be the final Entry contract.

The final Entry replica contract should not carry `captureId`. Captures are local-only before Confirmation; after Confirmation the Entry `id` and Sync Intent idempotency key are the durable identities.

The first Contact replica contract should preserve imported phone Contacts as raw `vcardText` plus parsed fields JobDone currently understands. This keeps vCard/VCF import/export simple and avoids losing contact details that the current UI does not model yet.

Encrypted Payload Mode is the intended default future mode for privacy-sensitive Local Replica payloads before JobDone has real users. In that model, the backend remains an encrypted sync store and querying moves to the frontend peer. Outer sync metadata such as IDs, owner scope, transaction facts, tombstones, collection names, access rows, and payload hashes remain readable for sync correctness, while privacy-sensitive payload fields such as Entry text, Contact vCard data, Location labels/coordinates, Photos, and attachments are encrypted unless the user or Team explicitly opts into server-readable improvement/debug/AI features. This needs a separate ADR before implementation.

Encrypted Payload Mode uses one symmetric Data Key per Owner Scope. The personal User Owner Scope has its own Data Key; every Team Owner Scope has its own Team Data Key. Each Data Key is wrapped into Keybag records for authorized users, devices, or credentials, so inviting a Team Member grants access to the Team Data Key instead of re-encrypting every Team payload. Backend-stored Data Keys must never be plaintext.

Encrypted cold restore should use Sync Partitions: coarse backend-readable buckets such as Owner Scope, collection, Server T range, broad time bucket, payload kind, payload size, and tombstone state. Sync Partitions are not search partitions. They exist so a fresh or evicted device can fetch the right encrypted blobs without revealing Contact, Location, Backlog Item, Work Context, or query-specific relationships.

The user's default personal surface may be described in UX as a Private Context, but it remains `ownerKind: user` in the Local Replica protocol. It should not be represented as a hidden one-person Team until a concrete Team lifecycle need proves that extra model complexity useful.

Account authentication and encrypted-data unlock are separate responsibilities. Authentication proves which User is asking and allows encrypted blobs plus Keybag metadata to sync. An Unlock Method locally unwraps Data Keys. The preferred Unlock Method is platform passkey/WebAuthn PRF where available; the fallback is a user-held Recovery Key or recovery phrase. After first unlock, a device may cache or locally wrap keys for frictionless reopening. There is no backend recovery backdoor for encrypted payloads. This encryption model should not depend on any one authentication mechanism such as magic links, OAuth, or passkeys.

The UX goal is Frictionless Encryption. Users need clear context and sharing cues, such as whether they are saving into a Private Context or Team Context, but should not have to understand keys, ciphers, wrapping records, or sync payload modes during ordinary capture, recall, sync, or Team work.

Team Membership and Readable Team Access are separate states in Encrypted Payload Mode. The backend can record Team Membership and ACL metadata before the invitee has a Keybag record that can unwrap the Team Data Key. The UI should hide this distinction whenever access finishes immediately; if it cannot, use product-language status such as "Finishing Team access" or "Waiting for Team access from the owner" rather than crypto terminology.

Access Revocation stops future access; it is not retroactive forgetting. Revoking a Team Member removes future membership/ACL and Keybag access and stops future sync for that User. Data already decrypted or cached on that member's device may remain until the app processes revocation or local data is cleared. A Team may rotate its Team Data Key after revocation to protect future payloads, but key rotation is a stronger follow-up feature rather than the MVP definition of revocation.

GDPR/account deletion should combine explicit deletion or tombstoning with Crypto-Erasure rather than relying on key deletion alone. Personal account deletion removes or tombstones server sync objects for the User Owner Scope where required, destroys/deletes User Data Key and Keybag records, and clears local device data for that user. Leaving a Team does not delete Team data; Team deletion is a Team owner/admin action that removes or tombstones Team sync objects and destroys/deletes Team Data Key access. User export must happen while unlocked because the backend cannot read encrypted payload content.

Normal Recall/search should move to Local-First Recall. The device searches locally materialized data after sync and, later, after local decrypt. This can be implemented before Encrypted Payload Mode because it already reduces backend content dependency. Backend Recall should become an opt-in or secondary path for users/Teams that explicitly allow server-readable content or a privacy-preserving compute path.

Large Team data is the most likely case where local-only Recall becomes impractical. A later Server-Readable Team Recall mode may let an enterprise or large Team deliberately run server-side storage and Recall over readable Team payloads, ideally in a self-hosted or enterprise-controlled environment. That mode must be explicit Team-level consent, not a silent fallback from Encrypted Payload Mode, and should not weaken the default personal/private data model.

Local-first does not prevent future semantic or vector search. The first Recall implementation should keep the simple property-testable baseline: deterministic matching over confirmed Entry-centered facts and Context Clues. Vector indexes, embeddings, or semantic reranking can be added later as derived local indexes, encrypted sync artifacts, or opt-in compute paths if dogfooding and property tests show the deterministic baseline misses real queries.

The first Local-First Recall implementation should use an on-the-fly Recall Scan rather than a persisted search index. It should load confirmed local Entries and linked Contacts, Locations, Work Contexts, and time facts from IndexedDB, build candidate text in memory, and score deterministically. A derived local search index can be added later as a rebuildable cache if dogfooding or profiling proves the scan is too slow.

Context Clue links belong to a Private Relationship Graph by default. Even opaque Contact, Location, Backlog Item, or Work Context IDs can leak that multiple Entries relate to the same hidden object or that a user is searching/fetching around that object. Encrypted Payload Mode should therefore avoid backend-readable relationship tables such as `entryContactLinks` unless the user or Team explicitly opts into a feature that needs them. Cold restore should fetch coarse owner/collection/time partitions, then rebuild relationship/search state locally after decrypting payloads.

Postgres remains the MVP implementation because Supabase Auth, SQL debugging, and deployment are already in place. The protocol should not assume Postgres-specific row semantics for payload data, so a future ordered transactional key-value implementation such as FoundationDB remains plausible if scale, enterprise privacy, or operational needs justify it.

## Alternatives

Using `updatedAt > lastSync` was rejected because device clocks and wall-clock ordering are not reliable enough for sync correctness.

Using a public append-only event log was rejected for MVP because the app needs current state quickly, and rebuilding state in every client would complicate IndexedDB and property testing. JobDone can still keep immutable domain facts and tombstones, and can add event/audit tables later if the product needs them.

Adopting a full local-first sync product such as Replicache, Zero, Electric, PowerSync, RxDB, or WatermelonDB was deferred. Their ideas are useful, especially optimistic local writes, mutation IDs, pull cookies, schema versions, and scoped shapes, but taking a dependency now would be a rewrite before the sync contract itself is proven.

## Consequences

CI should include schema conformance checks for JobDone-owned tables: `jobdone` schema only, camelCase identifiers for JobDone data, UUID owner IDs, UUID syncable IDs, required transaction fields for syncable rows, scoped association FKs, RLS enabled, and no `remoteId` or backend server IDs in app-facing contracts.

Schema checks should support explicit modes. During MVP, `mvp-clean` mode checks contract shape and allows destructive clean resets. Its first CI implementation can statically check checked-in SQL so GitHub Actions does not need lab database access. Once JobDone enters user-preserving safety mode, schema CI should add nondestructive/backwards-compatibility checks such as rejecting table drops, column drops, incompatible type changes, unsafe not-null changes, and unvalidated constraints unless a deliberate migration plan and backup path exist.

Property tests should be split at useful boundaries:

- contract and schema conformance
- backend API plus real Postgres
- IndexedDB plus frontend sync adapter
- later, a full app wake-up sync harness without Playwright button pushing

These tests should prove preservation of IDs, associations, tombstones, transaction ordering, and no cross-user or cross-team leakage.

## Decomplex Review (2026-06-10 to 2026-06-11)

The settled schema lives in `docs/schema.sql`. The deleted `docs/sync-schema-proposal.sql` was a temporary scratch file.

**1. payloadMeta envelope replaces flat codec/encryptionMode/schemaVersion columns.**
These three axes vary independently and encrypted mode needs additional fields (`keyId`, `algorithm`, `nonce`). A single `payloadMeta jsonb` envelope carries all of them. MVP default: `{"codec":"json","encryptionMode":"none","schemaVersion":1}`.

**2. syncTransactions is ordering-only. Actor identity moves to syncTransactionActors.**
`t` is safety-critical and must never be mutated. Actor fields (`actorUserId`, `actorEmail`, `actorDeviceId`) are diagnostic and subject to GDPR erasure. Separating them means erasure deletes rows from `syncTransactionActors` without touching the ordering record.

**3. SyncIntent wire shape splits into SyncEnvelope and SyncIntent.**
`SyncEnvelope { id, replicaEpoch, baseT, createdAt }` handles retry/idempotency plumbing. Generic object `SyncIntent` records carry storage intent fields such as `action`, `ownerKind`, `ownerId`, `collection`, `objectId`, and `payloadJson`. Product Actions carry JobDone business commands such as `claimBacklogItem` separately in `syncActions`, as described in ADR 0011. The `syncIntents` ledger stores only the envelope id and an `intentHash` — not the full parsed action. Policy tests construct Product Action/state objects without envelope noise.

**4. syncOwnerAccess is capability-grant rows, not a single "has access" record.**
`capability` is one of `pull | push | readable_access`. Personal scope gets `pull` + `push` auto-created on account creation. Team `readable_access` is a separate grant added when Keybag is set up. Revocation sets `revokedAt`; rows are never deleted. GDPR erasure deletes all rows for a `userId` without touching Team data.

**5. replicaEpoch removed from syncObjects rows.**
`replicaEpoch` is a client-envelope concept for cold-restore detection. It belongs only in request/response envelopes and a server-side `replicaState` record. Pull response carries `resetRequired: true` when the server epoch has changed. Individual stored objects carry only `createdT` and `changedT`.

**6. Product runtime wraps generic storage through a transaction pipeline.**
The reusable backend pipeline is:

```text
request
→ auth identity check
→ open DB transaction
→ ACL check
→ deterministic lock acquisition
→ product action/rule check
→ write syncTransactions, syncObjects, syncObjectPublicProduct, syncIntents, syncActions, outboxEffects
→ commit
→ generic outbox runner handles post-commit effects
→ HTTP adapter maps typed runtime result to status code
```

Business truth and outbox scheduling commit atomically. Post-commit effects such as email, AI, indexing, and push notification use a mailbox/outbox pattern and never roll back accepted business state.

**7. Product-readable facts are explicit public product projections.**
The generic storage engine remains dumb and reusable. JobDone-specific rule/routing/list facts live in `syncObjectPublicProduct.publicProductJson`, not directly in `syncObjects`. This JSON is deliberately public to the backend and must contain only non-sensitive product facts that JobDone needs for rules, conflicts, safe filtering, or list UI.

`publicProductJson` is a latest-only projection. It is replaced as a whole document on each accepted transition. It is not patch/merge state and it is not a history table. Each projection carries `schemaName` and `schemaVersion`; shared Zod schemas define valid shapes, while the backend product runtime remains the authority that derives the next projection.

No object gets a public product projection by default. Add one only when rules or safe server-side behaviour need it. Likely JobDone MVP projections include Teams, Team Members/access facts, Team Invites, Backlog Items, and Approval Requests. Entry text, Contacts, Locations, Photos, Captures, and private Context Clue links remain private/encrypted payload content unless a Team or user explicitly opts into a server-readable feature.

**8. Product actions use declared multi-object write sets.**
Actions may compose several object writes in one transaction, but each action declares the object refs it may lock/write before running. The runtime locks those refs in deterministic order to avoid deadlocks and to make race handling property-testable. The client sends intent args; the server validates with Zod, reads current projections, enforces policy, and derives the complete next projections. The client never gets to assert that a protected transition succeeded.

**9. Effects use a generic outbox runner plus product handlers.**
The transaction writes typed `outboxEffects` rows after validating `effectJson` with an effect-specific Zod schema. The response may report effects as queued, but not delivered. A generic runner claims due effects, retries with backoff, marks succeeded/failed/dead, and delegates actual work to product handlers such as `sendTeamInviteEmail` or `enqueueAiSummary`. Effect handlers live in the app backend repo for MVP and can be extracted later once the seam proves useful.

**10. Runtime failures use opsEvents, not feedback.**
User feedback and machine/runtime failures are separate streams. `feedback` remains human product signal. `opsEvents` records backend/runtime failures and unusual states only, best-effort after rollback, with sanitized details and a request ID. Successful business actions do not create `opsEvents`; success is already represented by `syncTransactions`, `syncObjects`, `syncIntents`, and `outboxEffects`.

The generic transaction runner returns typed result objects rather than HTTP statuses. HTTP adapters map results to `401`, `403`, `409`, `422`, `500`, or `503`. Production responses hide internals and include request IDs; debug-allowlisted users may receive sanitized diagnostic detail.
