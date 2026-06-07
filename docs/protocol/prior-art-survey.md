# Privacy-First Sync Prior Art Survey

Research date: 2026-06-07.

Short answer: there does not appear to be one widely adopted, generic, standards-track protocol for privacy-first app-data sync in the shape JobDone is exploring. There is serious prior art. The closest systems should be studied before claiming novelty or extracting a library.

## Comparison Matrix

| System | What it is | Server reads content? | Local-first? | Generic app data? | Relationship/privacy metadata stance | Query coverage concept | Fit for our protocol goal | Practical verdict |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Etebase / EteSync | E2EE SDK/backend for app data | No, by design | Partly; client-heavy sync | Yes: Collections, Items, Revisions | Has encrypted collections/items; uses deterministic encrypted collection type tokens for efficient fetch | Sync tokens, not explicit local query completeness | Very close for central-server E2EE app sync | Study deeply before building encryption; possible reuse/fork candidate if maintenance/API fit works |
| any-sync / Anytype | P2P/local-first E2EE collaboration protocol | No, by design | Yes | Yes, but space/DAG/CRDT-oriented | Encrypted spaces and signed DAG/CRDT updates | Not framed around "search has complete local coverage" | Strong prior art, but more decentralized/complex than current need | Learn from it; probably too much machinery for MVP |
| Replicache | Local-first optimistic sync framework | Usually yes unless app encrypts payloads | Yes | Yes, app-defined | Privacy is app responsibility | No first-class privacy/search coverage | Great sync UX model, not privacy protocol | Borrow mutation/pull concepts; not replacement |
| PowerSync | Backend DB to local SQLite sync engine | Usually yes unless app encrypts rows | Yes | Yes, table/database oriented | Sync rules/streams choose subsets; privacy depends on schema | Has sync status, not encrypted Recall coverage | Excellent local DB sync, weak fit for server-blind payloads by default | Consider if abandoning custom sync; otherwise borrow local DB ideas |
| ElectricSQL | Postgres subset sync into local apps | Usually yes unless app encrypts rows | Yes | Yes, Postgres-shaped | "Shapes" choose subsets of data | No explicit false-completeness search model | Useful subset/shape idea, not E2EE protocol | Borrow Sync Partition inspiration |
| RxDB | JS local-first DB with replication plugins | Depends on chosen backend/encryption | Yes | Yes, document DB | Encryption/compression possible; metadata model app-defined | No protocol-level coverage | Useful frontend DB/sync toolkit | Could be implementation tool, not protocol |
| Matrix | Open communication protocol with sync API and E2EE | Homeserver sees metadata; encrypted room content can be private | Heavy clients possible | Event/room communication, not arbitrary app replica | Mature device/key concepts; metadata leakage remains | Limited timelines/sync gaps, not app-data query coverage | Relevant for sync/key-management patterns only | Do not repurpose unless app is communication-shaped |
| MLS | IETF E2EE group messaging protocol | Delivery service cannot read encrypted messages; metadata remains | Not a sync engine | Messaging only | Strong crypto/key schedule; explicit metadata limits | None | Crypto ingredient, not app-data sync | Use as reference for group crypto, not storage/sync |
| Syncthing/file sync | File-level peer sync | Peers read; relays usually do not | Yes for files | Files, not typed app data | File names/structure may leak depending design | File availability, not query coverage | Too low-level | Useful durability intuition only |
| Firebase/Firestore | Managed cloud DB with offline cache | Yes unless app encrypts fields | Offline cache, not privacy-first local replica | Yes | Security Rules protect access, not provider readability | Cache state, not complete private Recall coverage | Solves generic sync, not server-blind privacy | Use if privacy-first requirement is dropped |

## "Has Someone Already Done It?"

Mostly yes for pieces, not exactly for the current narrow shape.

If the goal is "E2EE app-data backend", Etebase is the closest. Before building encryption, we should check whether Etebase can be reused, forked, or copied conceptually.

If the goal is "local-first E2EE collaboration protocol", any-sync is already serious and more ambitious.

If the goal is "local-first sync with nice optimistic UI", Replicache, PowerSync, ElectricSQL, and RxDB all cover much of that ground.

The distinctive slice in our draft is the combination of:

- central server as ordering/authorization/durability, not reader
- typed app object sync through Sync Intents and Server T
- coarse Sync Partitions for encrypted cold restore
- Private Relationship Graph hidden from backend by default
- explicit Recall/query coverage so local search does not lie
- implementation-independent shape that can run on Postgres first

That may be useful, but it is a refinement of existing ideas, not a clean-room invention.

## Closest Prior Art

### Etebase / EteSync

Etebase is the closest central-server comparison. Its docs describe an end-to-end encrypted backend where the server has no access to user data and mostly stores/assists clients. Its core objects are Collections, Items, and Revisions, with sync tokens for efficient change fetches.

Relevant ideas:

- server stores encrypted app data
- client-side operations
- collections/items as generic application data containers
- revisions/history
- sync tokens
- collection sharing
- deterministic encrypted type tokens for efficient collection filtering

Useful difference for JobDone:

- JobDone's current direction emphasizes Server T ordering, Sync Intents, coarse Sync Partitions, local Recall coverage, and hiding the private relationship graph by default.
- Etebase should be treated as close prior art, not ignored.

Sources:

- https://docs.etebase.com/overview
- https://docs.etebase.com/protocol-specs/collections
- https://blog.etesync.com/introducing-etebase-an-end-to-end-encrypted-sdk-and-backend/

### any-sync / Anytype

any-sync is an open-source protocol for local-first, peer-to-peer, end-to-end encrypted collaborative apps. It uses encrypted spaces and DAG/CRDT-style structures.

Relevant ideas:

- encrypted user-owned channels/spaces
- local-first and peer-to-peer operation
- provider switching
- CRDT/DAG verification
- self-hostable infrastructure

Useful difference for JobDone:

- any-sync aims at decentralized collaboration and P2P/provider-switching.
- JobDone's draft protocol is narrower: server-assisted ordering and restore for typed app data, with privacy and coverage over generic P2P collaboration.

Source:

- https://github.com/anyproto/any-sync

## Adjacent Local-First Sync Engines

### Replicache

Replicache gives optimistic mutations, subscriptions, sync, offline support, and a build-your-own-backend model.

Useful ideas:

- local mutations
- optimistic UI
- server reconciliation
- subscriptions
- app-specific backend endpoints

Limit for this protocol:

- Replicache is not primarily a server-blind encrypted app-data protocol.

Source:

- https://doc.replicache.dev/

### PowerSync

PowerSync syncs backend databases into local embedded SQLite databases and supports offline/local-first usage.

Useful ideas:

- local DB as UI read/write surface
- backend sync rules/streams
- offline upload queue
- multi-platform clients

Limit for this protocol:

- Its usual model syncs readable database rows. End-to-end encrypted, graph-blind payload sync would still need an app-level design.

Sources:

- https://docs.powersync.com/
- https://docs.powersync.com/resources/local-first-software

### ElectricSQL

Electric syncs subsets of Postgres data into local apps. Older docs call these subsets "shapes".

Useful ideas:

- sync only required subsets
- Postgres-backed local-first apps
- type/schema-aware local access

Limit for this protocol:

- The shape model is useful, but by itself it is not a privacy-first encrypted payload protocol.

Sources:

- https://electric-sql.com/product/sync
- https://legacy.electric-sql.com/docs/usage/data-access/shapes

### RxDB

RxDB is a JavaScript local-first database with sync plugins and support for local querying, replication, encryption, and compression.

Useful ideas:

- local-first JavaScript DB
- observable local queries
- custom or plugin-based replication
- encryption/compression hooks

Limit for this protocol:

- It is a database/sync engine rather than a generic privacy-first wire protocol with explicit backend-blind relationship and coverage semantics.

Sources:

- https://rxdb.info/
- https://rxdb.info/replication.html

## Messaging and Communication Standards

### Matrix

Matrix defines open APIs for decentralized communication and has a `/sync` API for client state. It also supports end-to-end encryption.

Useful ideas:

- open client-server sync API
- incremental sync tokens
- local persistent clients
- encrypted device/key management

Limit for this protocol:

- Matrix is communication/event-room infrastructure, not generic private app-data replica sync.

Sources:

- https://spec.matrix.org/latest/
- https://spec.matrix.org/latest/client-server-api/index.html

### Messaging Layer Security

MLS is an IETF standard for end-to-end encrypted group messaging.

Useful ideas:

- use standards-track crypto for groups where possible
- group epochs and key schedule concepts
- explicit metadata leakage discussion

Limit for this protocol:

- MLS is an encryption protocol for messaging, not a local-first app-data sync protocol. It may inform Keybag/team access design but does not replace the sync protocol.

Source:

- https://www.rfc-editor.org/rfc/rfc9420.html

## File Sync and Backup Tools

Tools such as Syncthing, Resilio Sync, encrypted backup systems, and encrypted cloud storage solve file-level synchronization and transfer privacy. They are useful for durability and transport ideas, but they do not usually provide typed app-data intents, transaction cursors, local materialization, or query coverage.

## Design Implications for JobDone

1. Do not claim "no one has done this." The space is active.
2. Study Etebase before implementing Encrypted Payload Mode.
3. Keep the protocol narrower than any-sync: server-assisted restore/order, not full P2P collaboration.
4. Keep local-first sync engines as implementation inspiration, not protocol definitions.
5. Treat coverage as a key differentiator: encrypted local Recall needs to know whether it has all searchable data.
6. Treat metadata leakage as first-class: opaque IDs are not enough if they expose a private relationship graph.
7. Use existing crypto standards and libraries; do not invent cryptography.

## Positioning Sentence

JobDone's Local Replica is an implementation of a small privacy-first sync protocol: servers order, authorize, store, and restore encrypted app objects, while clients own private content, private relationships, and query completeness.
