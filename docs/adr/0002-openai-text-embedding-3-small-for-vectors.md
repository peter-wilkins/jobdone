# Voyage 3 for Entry embeddings

Entry summaries are embedded using Voyage AI's `voyage-3` model and stored as 1024-dimensional vectors in pgvector on Supabase. This supersedes the earlier OpenAI `text-embedding-3-small` decision because the implementation and schema now use Voyage, and keeping the model family aligned with the rest of the AI stack is more important than the original OpenAI setup convenience.

## Consequences

Migrating to a different embedding model later requires re-embedding all existing Entry summaries and updating vector dimensions if the replacement model differs. The model choice is stored alongside each embedding so a future migration can identify which Entries need re-processing.
