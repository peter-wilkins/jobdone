# Etebase Deep Dive

Research date: 2026-06-07.

## Short Verdict

Etebase is the closest prior art for a central-server, end-to-end encrypted app-data backend. It is close enough that JobDone should study it before building Encrypted Payload Mode.

It should not replace the current Local Replica design wholesale yet.

Reasons:

- Etebase solves encrypted Collections, Items, Revisions, sharing, and zero-knowledge password login.
- JobDone still needs Sync Intents, Server T, coarse Sync Partitions, private relationship graph handling, local Recall coverage, and frictionless auth that is not password-rooted.
- Current JavaScript package/repo signals look stale for a direct PWA dependency: `etebase` npm last modified 2022-05-01; `etebase-js` repo pushed 2023-03-14. Server is less stale but still not fast-moving: `etesync/server` pushed 2024-07-12. Android EteSync is active in 2026, so the wider project is not dead.
- Server license is AGPL-3.0; JS client is BSD-3-Clause; React Native helper is LGPL-3.0-only. AGPL is fine for self-host/open source, but it matters if we modify and run the server commercially.

## What Etebase Already Solves

### Server-blind encrypted app data

Etebase docs describe a backend where the server has no access to user data and mostly stores/assists clients. Its basic objects are Collections, Items, and Revisions.

Source: https://docs.etebase.com/overview

### Generic app data containers

Items can represent arbitrary data. Collections group Items and have metadata/content. This maps naturally to many app domains.

Potential JobDone mapping:

- Private owner scope -> one or more Etebase Collections.
- Team owner scope -> shared Etebase Collection.
- Entry, Contact, Location, Backlog Item -> Etebase Items.
- Attachments -> Etebase Items or item content chunks.

### Sync tokens

Collections have `stoken` values, and collection fetches can ask for recent changes only. This is close to our pull cursor concept, but scoped differently.

Source: https://docs.etebase.com/guides/using_collections

### Sharing

Etebase supports public-key sharing of Collections, invitations, member listing, access-level modification, revocation, and leaving collections.

Source: https://docs.etebase.com/guides/collection_sharing

### Consistency checks

Etebase supports transactions and `stoken` consistency checks so uploads can fail if the client is stale.

Source: https://docs.etebase.com/guides/using_collections

### Browser/mobile client support

Etebase has JS/TypeScript, React Native, Python, Java/Kotlin, C/C++, and Rust client options. Browser use relies on WebAssembly and Web Workers; docs warn CSP can block this and suggest allowing `unsafe-eval` and `blob:` for scripts/workers.

Source: https://docs.etebase.com/installation

### Self-hosting

The server is a Django/ASGI app. It can be deployed from source, with database and `MEDIA_ROOT` backups required. Test Docker images exist for CI/client testing.

Source: https://github.com/etesync/server

## Gaps Against JobDone's Draft Protocol

### Server T vs stoken

JobDone wants one Datomic-like monotonic `Server T` for accepted backend transactions. Etebase uses `stoken` values for changed collections/items.

This is not necessarily worse, but it changes test shape. Our property tests currently want global ordering and set convergence around `Server T`; Etebase would require proving equivalent properties around collection-scoped tokens.

### Sync Intents

JobDone's draft protocol makes business actions first-class Sync Intents: claim item, submit evidence, approve, accept invite, upsert object, tombstone object.

Etebase has object uploads, transactions, items, revisions, and sharing, but not our business-action intent layer. We would still need an application-level intent log/queue for Team races and friendly conflict UX.

### Recall coverage

Etebase tells clients what changed, but it does not appear to have a first-class "local query coverage" concept. JobDone needs Recall to know whether searchable text is complete, partially restoring, or intentionally filtered.

We could build coverage on top of Etebase by defining time-bucketed collections or app-level manifests, but that is our protocol work, not solved by Etebase.

### Private Relationship Graph

Etebase can store relationships inside encrypted item content. That is good.

However, if JobDone maps every Contact, Location, and Entry to separate Items and fetches by item/collection patterns, we still need to avoid leaking query intent or private graph shape through server-visible access patterns. Etebase helps with encrypted payloads, but the app still owns metadata leakage design.

### Sync Partitions

Etebase collection types use deterministic encrypted tokens so clients can fetch collections by type without revealing clear-text type names. That is relevant prior art.

JobDone's Sync Partitions are broader: owner scope, collection, time bucket, payload kind/size, tombstone state, and restore coverage. We could model partitions as collections, but that would be a design decision, not a ready-made feature.

### Auth model

Etebase authentication derives encryption material from a user password and uses challenge-response login. JobDone wants auth and encrypted-data unlock to stay separate, with no long-term assumption that magic links, Google OAuth, or passkeys are the root of encryption.

Etebase's current auth is elegant but password-centered. That conflicts with the desired frictionless/no-password direction unless we wrap or adapt it carefully.

Source: https://docs.etebase.com/protocol-specs/authentication

### Team invite UX

Etebase sharing asks clients to fetch and verify the recipient public key, ideally through a secure channel. JobDone wants frictionless email invite flows where clicking the invite can also log the user in.

Etebase's cryptographic trust model is stronger than our MVP UX, but less frictionless. We need to decide whether that tradeoff is acceptable before reuse.

## Reuse Options

### Option A: Adopt Etebase as backend and client

Use Etebase server and JS client, model JobDone data as Collections/Items, and build JobDone materializers/query coverage on top.

Pros:

- E2EE storage/sharing already built.
- Self-hostable.
- Existing protocol/docs.
- Multi-language clients.

Cons:

- Auth mismatch.
- AGPL server.
- JS package appears stale.
- Need to rebuild Local Replica around Etebase's collection/stoken model.
- Still need Sync Intents and Recall coverage.

Verdict: not now.

### Option B: Use Etebase as conceptual source, keep JobDone protocol

Study Etebase's cryptography, collection sharing, sync tokens, transaction checks, and metadata choices. Keep implementing Local Replica on Supabase/Postgres first.

Pros:

- Lowest disruption.
- Keeps current property-test direction.
- Lets JobDone keep frictionless auth and Server T.
- Avoids AGPL/runtime dependency risk.

Cons:

- More code to build.
- Must not invent crypto badly.
- Need later security review.

Verdict: recommended.

### Option C: Fork/adapt Etebase

Fork server/client and add Server T, Sync Partitions, coverage manifests, or auth changes.

Pros:

- Builds on serious prior art.
- Could become credible open source if done well.

Cons:

- High maintenance cost.
- AGPL implications.
- Forking security-sensitive code is risky.
- Could become the whole project.

Verdict: only if JobDone becomes serious sync-infra product.

### Option D: Use Etebase only for encrypted blob store behind Local Replica

Keep JobDone Sync Intents/Server T elsewhere, but store encrypted payload blobs through Etebase.

Pros:

- Reuses encrypted storage/sharing.
- Keeps some of our protocol.

Cons:

- Two sync systems.
- More failure modes.
- Harder property tests.
- Likely worst of both worlds.

Verdict: avoid.

## Replacement Decision

Etebase does not make the JobDone Local Replica plan unnecessary.

It does make the crypto/storage part less novel. The protocol docs should be honest: JobDone is refining existing ideas around app-specific intents, cold restore partitions, private relationship graph leakage, and query coverage.

## Recommended Next Move

Before implementing Encrypted Payload Mode:

1. Build one throwaway Etebase spike outside JobDone.
2. Store a fake Entry, Contact, Location, and Attachment.
3. Share a collection with a second test user.
4. Test browser bundle/CSP in our PWA environment.
5. Measure whether collection/item fetch can support "complete Recall coverage".
6. Decide whether Etebase can be reused or remains prior art only.

Do not block the current Local Replica cleanup on this. Use it before encryption work, not before ordinary sync/Recall work.

