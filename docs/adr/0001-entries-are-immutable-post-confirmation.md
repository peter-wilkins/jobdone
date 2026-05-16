# Entries are immutable post-confirmation

Once a user confirms an Entry, it cannot be edited. If a plumber needs to correct or add context, they submit a new Entry. This was chosen over allowing summary/metadata edits because it keeps the Timeline a faithful legal-grade log, eliminates re-embedding complexity, and matches how a real job logbook works. The trade-off is that a bad summary is permanent — which makes the confirmation screen load-bearing. We accept this because the confirmation step is already a deliberate user gesture, and "append a correction" is a natural pattern for tradespeople.

## Considered options

- **Allow summary edits post-confirmation** — rejected because it breaks the immutable trust model, requires re-embedding on edit, and adds UI complexity (edit history, version display).
- **Allow metadata edits only (not transcript/summary)** — rejected as an awkward middle ground that still requires re-embedding and doesn't simplify the UX enough to justify the split model.
