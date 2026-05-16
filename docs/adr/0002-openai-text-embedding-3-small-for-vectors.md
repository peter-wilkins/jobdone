# OpenAI text-embedding-3-small for entry embeddings

Entry summaries are embedded using OpenAI's `text-embedding-3-small` model and stored in pgvector on Supabase. This was chosen over Voyage AI (Anthropic's recommended partner) and self-hosted sentence-transformers because it has the best-documented pgvector integration, low per-token cost (negligible for short 1-2 sentence summaries), and is straightforward to set up. Anthropic has no native embeddings API.

## Consequences

Migrating to a different embedding model later requires re-embedding all existing Entry summaries — a bulk operation, not a schema change. The model choice should be stored alongside each embedding so a future migration can identify which entries need re-processing.
