# Incrementally type boundaries before replacing the SQL layer

JobDone will stay SQL-first while reducing bug risk with incremental TypeScript, Zod boundary contracts, and a typed SQL layer evaluation. This was chosen after sync/login bugs showed weak payload and database-shape contracts, but did not justify a frontend/backend rewrite.

The first reliability slice should add TypeScript checking around existing JavaScript and validate runtime boundaries: environment variables, API request bodies, API responses where useful in debug/test, Local Replica payloads, and database adapter inputs. JobDone should not introduce a classic ORM or broad framework rewrite during MVP mode.

Because JobDone has no real users yet, these contracts should prefer clean canonical shapes over compatibility adapters. If old local drafts, stale IndexedDB data, or disposable prototype database rows block a cleaner contract, delete/reset them during MVP rather than preserving multiple payload variants.

Kysely is the preferred candidate to replace the homegrown Supabase-like query builder because it is SQL-like and can use generated database types. PgTyped remains a good option for complex raw SQL paths such as Recall. Named prepared statements should not be added while JobDone uses Supabase transaction pooling; parameterized queries remain required.

## Consequences

New reliability work should target high-value boundaries before broad file conversion. TypeScript and Zod are guardrails, not a replacement for schema verification, sync property tests, and device QA. The database remains the source for table shape; app code should avoid duplicate hand-maintained schemas where generated types are practical. Normalization layers should be temporary and explicit, not a default architecture.
