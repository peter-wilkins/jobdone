# Incrementally type boundaries before replacing the SQL layer

JobDone will stay SQL-first while reducing bug risk with incremental TypeScript, Zod boundary contracts, and a typed SQL layer evaluation. This was chosen after sync/login bugs showed weak payload and database-shape contracts, but did not justify a frontend/backend rewrite.

The first reliability slice should add TypeScript checking around existing JavaScript and validate runtime boundaries: environment variables, API request bodies, API responses, Local Replica payloads, and database adapter inputs. JobDone should not introduce a classic ORM or broad framework rewrite during MVP mode.

Zod schemas are the source of truth for app/API data shapes. TypeScript types should be inferred or generated from those schemas instead of maintained as duplicate hand-written interfaces. Boundary code should validate every trust crossing: frontend before HTTP send, backend at route entry, frontend when HTTP responses return, and IndexedDB read/write for collections with active sync risk. Internal functions should not get blanket validation unless a concrete bug or test gap proves the need.

Contract failures must fail closed while preserving local data. Frontend outbound validation failures should stop the request and keep the local row pending. Backend inbound validation failures should return `400` before mutation. Frontend response validation failures should ignore the response and keep local data pending rather than trusting a bad shape. Normal UI should say sync hit a problem and local data is safe; debug or beta reporting can include the specific contract error.

Because JobDone has no real users yet, these contracts should prefer clean canonical shapes over compatibility adapters. If old local drafts, stale IndexedDB data, or disposable prototype database rows block a cleaner contract, delete/reset them during MVP rather than preserving multiple payload variants.

Entry sync will use one camelCase API/local payload shape:

```js
{
  entryData: {
    id,
    captureId,
    transcript,
    summary,
    createdAt,
    contextClues,
    locations,
    contacts,
    tags,
    attachments
  }
}
```

Snake_case names such as `created_at`, `capture_id`, and `context_clues`, and UI-local aliases such as `locationSnapshots` or `attachmentSnapshots`, should not cross the API boundary. The backend may map to database column names only at the database adapter boundary.

IndexedDB Entry records should also use the canonical camelCase app shape. Local storage is not a second naming convention. During MVP, stale local Entry data can be upgraded or reset rather than preserving duplicate field names. Non-Entry local stores can keep their current shape until each collection gets its own local replica slice.

Shared API contracts should live in a small root-level `shared/contracts/` module imported by both frontend and backend. Start with plain JavaScript plus Zod, then let TypeScript checking grow around it; do not add package/workspace ceremony before it proves useful. Because the repo is not a workspace package yet, root shared modules should avoid bare package imports; frontend/backend can provide small local Zod wrappers that resolve dependencies from their own package installs.

The first TypeScript step should be a narrow type-check lane for `shared/contracts/` and touched boundary modules only, using JSDoc plus Zod-inferred types. Do not rename broad frontend/backend files to `.ts`/`.tsx` or enable repo-wide `checkJs` until the boundary lane is useful and quiet. The initial acceptance bar is that CI catches wrong field names at active sync boundaries.

After contact and location sync contracts, the next contract-hardening slice should target Entries and Captures because they carry the highest data-loss risk. Confirmed Entry sync, Capture-to-Entry confirmation, and local IndexedDB persistence should reject legacy aliases such as `created_at` or `locationSnapshots` at boundaries instead of silently normalizing them. Captures remain local-only: this slice can validate local Capture storage and Capture-to-Entry confirmation, but raw unconfirmed Captures must not sync to the backend.

Do not change the database access layer during the first contract-hardening slice. Keep pure parameterized SQL while API and Local Replica contracts are being proven. Kysely is the preferred later candidate to replace the homegrown Supabase-like query builder because it is SQL-like and can use generated database types. PgTyped remains a good option for complex raw SQL paths such as Recall. Named prepared statements should not be added while JobDone uses Supabase transaction pooling; parameterized queries remain required.

## Consequences

New reliability work should target high-value boundaries before broad file conversion. TypeScript and Zod are guardrails, not a replacement for schema verification, sync property tests, and device QA. The database remains the source for table shape; app code should avoid duplicate hand-maintained schemas where generated types are practical. Normalization layers should be temporary and explicit, not a default architecture.
