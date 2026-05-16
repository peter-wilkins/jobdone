# JobDone

A mobile-first voice log for self-employed tradespeople that externalises operational memory — capturing what happened on a job and surfacing it at the moment it's needed.

## Language

**Entry**:
A single user submission to the log — voice recording or text — timestamped and fully immutable once confirmed. Photos are deferred post-MVP. Corrections are made by submitting a new Entry.
_Avoid_: Event, Job, Note, Recording, Log

**Timeline**:
The chronological stream of all confirmed Entries — the user's full operational memory.
_Avoid_: Feed, History, Log

**Recall**:
A natural-language question submitted through the same voice input as capture. Intent is classified by heuristics (question words and sentence structure) with a confirmation screen as the safety net for misclassifications. The system detects QUERY intent and filters the Timeline to relevant Entries — deterministically and cacheably. No AI synthesis at query time.
_Avoid_: Search, Lookup, Query

**Query**:
The saved text of a Recall question, transcribed from voice via the same input as capture. Queries are persisted and shown in a recent-queries dropdown so the user can re-run them with one tap, producing the same filtered Timeline.
_Avoid_: Search term, Filter

**Confirmation**:
The user gesture that commits a ready-for-review Entry into the Timeline. Irreversible.
_Avoid_: Save, Approve

**Rejection**:
Permanent deletion of an Entry before it reaches the Timeline. No recovery.
_Avoid_: Discard, Cancel

**Capture Bar**:
A browser-bar-style fixed input at the top of the screen — the single entry point for both capture and recall. Contains a mic icon to start recording, shows active Query text with a back button when a Query is active, and reveals a recent-Queries dropdown (chips, most-recent-first) when tapped.
_Avoid_: Search bar, Input field, Record button

## Relationships

- The **Timeline** is an ordered stream of **Entries** displayed chronologically — in-progress Entries (processing, ready-for-review, failed) appear at the top with distinct status styling; confirmed Entries follow below
- When a **Query** is active, the Timeline shows the top 10 matching Entries (by semantic similarity, above a loose relevance floor) under a "Showing results for: [query]" header — full Timeline restored on dismiss
- If no Entries pass the relevance floor, an explicit empty state is shown: "Nothing found — try rephrasing."
- An **Entry** moves through: `recording → ready_for_review → confirmed` (via Confirmation) or is permanently deleted (via Rejection)
- A **Query** moves through: `transcribing → ready_for_review` (user sees intent label + transcription, confirms or corrects) → filters Timeline and is saved to recent Queries
- The last 50 Queries are stored per user, deduplicated, most-recent-first, synced server-side. Shown as chips in a dropdown when the input is activated.
- An **Entry** belongs to no explicit grouping — retrieval is dynamic, not folder-based

## Example dialogue

> **Dev:** "When a user submits 'What did I do at Mrs Jones last month?' — is that an Entry or a Query?"
> **Domain expert:** "A Query — it filters the Timeline. But the system shows 'Searching…' for confirmation before acting, same as it shows 'Saving entry…' for a Note. Either can be cancelled."
> **Dev:** "And if the plumber taps that same query again from the dropdown next week?"
> **Domain expert:** "Same filtered Timeline. Deterministic. Any new Entries matching it will appear; nothing else changes."

## Flagged ambiguities

- "Job" was used in the codebase to mean what is now called an **Entry** — these are not the same thing. A job (the work done) is a real-world concept; an Entry is a capture. The code needs renaming.
- The spec mentioned "AI summaries editable separately" — resolved: Entries are fully immutable post-confirmation. Summary editing is not built. Corrections become new Entries.
- No explicit Customer or Property entity exists in MVP. Customer context is carried implicitly in Entry transcripts and surfaced via semantic retrieval. Proactive call-surface (Feature 3) is deferred post-MVP as it requires a contact/phone model.
