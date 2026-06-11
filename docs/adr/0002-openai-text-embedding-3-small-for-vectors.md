# Superseded: backend vector embeddings for Entry Recall

Status: superseded during the Local-First Recall pivot.

Earlier JobDone planned to embed Entry summaries using Voyage AI and store
1024-dimensional vectors in pgvector on Supabase. That matched the old
server-readable Recall design.

Current MVP Recall is local-first and deterministic over confirmed local
Entries and context clues. Backend vector search is not the default product
path, and should not be reintroduced without a fresh issue, property-test
evidence, and explicit privacy/consent design.

## Consequences

If server-readable or local vector Recall comes back later, model choice,
embedding dimensions, re-indexing, and privacy consent need a new ADR. The old
pgvector schema should be treated as legacy until that decision exists.
