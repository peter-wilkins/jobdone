# JobDone

A mobile-first voice log for self-employed tradespeople that externalises operational memory — capturing what happened on a job and surfacing it at the moment it's needed.

## Language

**Capture**:
Raw inbound material awaiting review — voice, text, shared contact, photo, or link — that may become an Entry, Person update, or both after Confirmation.
_Avoid_: Draft, Item, Import, Upload

**Entry**:
A confirmed submission to the Timeline, timestamped and fully immutable once confirmed. Corrections are made by submitting a new Entry.
_Avoid_: Event, Job, Note, Recording, Log

**Person**:
A contactable human known to the user, usually received through a shared contact or inferred from an Entry.
_Avoid_: Customer, Client, Account

**Photo**:
An image attachment received through a Capture and retained with the Entry after Confirmation.
_Avoid_: Image Entry, Scan, Upload

**Link**:
A URL attachment received through a Capture, stored with optional metadata but not a full content snapshot.
_Avoid_: Bookmark, Web Page, Search Result

**Inbox**:
The local review queue of unconfirmed Captures awaiting Confirmation or Rejection.
_Avoid_: Drafts, Queue, Imports

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
- Offline **Recall** can replay cached results for previously run Queries; new Recall requires the backend
- If no Entries pass the relevance floor, an explicit empty state is shown: "Nothing found — try rephrasing."
- A voice recording creates a **Capture**; transcription and summarization enrich the Capture before review
- A **Capture** is committed only through Confirmation, producing an Entry, a Person update, or both
- Confirmation does not require login; confirmed local data syncs after login when available
- Shared contacts, photos, links, and text always enter as **Captures** and require Confirmation before becoming Entries
- One OS share action creates one **Capture**, even when it contains multiple payloads
- The **Inbox** persists Captures locally, including offline shared Captures, until Confirmation or Rejection
- Captures are local-only before Confirmation; only confirmed outcomes sync
- A **Capture** is created only after all required payloads are stored locally; partial Captures are not valid
- Unsupported payloads cause the whole shared Capture to fail before creation in MVP
- First PWA/share-target implementation slice is app-shell installability plus text/link shared Captures; Photos and vCard/People follow
- A **Person** can be referenced by Captures and Entries, but does not imply billing ownership or a Customer model
- Sharing a contact creates or updates a deduplicated **Person** and creates a **Capture** that references that Person
- vCard is the canonical shared contact payload; text-only contact shares are parsed best-effort and reviewed
- **Person** deduplication uses normalized email or normalized phone number per user; names alone never deduplicate People
- **People** are local-first and sync to Supabase eventually, using the same per-user normalized identifier rules
- **Recall** returns Entries only; linked People can improve matching but are not returned as Timeline results
- A Person-only Confirmation updates People and removes the Capture from the Inbox without creating a Timeline Entry
- A minimal People surface lists, searches, and displays People; merge and full editing are deferred
- A Person with no linked Entries can be deleted; a Person linked to Entries is hidden from People surfaces while immutable Entry snapshots remain
- A **Photo** is attached to a Capture or Entry; it is not its own Timeline item
- A **Link** is attached to a Capture or Entry; fetching full page content is out of scope for MVP
- Original user-attached **Photos** are required parts of their Entry; derived artifacts such as thumbnails, OCR text, labels, and embeddings are optional
- Local IndexedDB is the source of truth for the current device experience; Supabase is a sync replica for cross-device continuity
- The PWA caches the app shell and static assets for offline opening; API responses are not the source of truth
- Foreground app-open retry is the canonical sync mechanism; browser Background Sync is only an optional optimization
- Android Chrome is the primary platform for Web Share Target; iOS and desktop PWA support are best-effort
- Web Share Target uses one POST endpoint for all inbound shares so text, links, contacts, and files follow the same Capture path
- Shared Captures open through a dedicated `/share-target` review route
- The service worker stores raw shared payloads and creates the Capture shell; app code parses and enriches payloads during review
- A **Capture** moves through: `recording → ready_for_review`; it is committed through Confirmation or permanently deleted through Rejection
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
- Photos were originally deferred post-MVP — resolved: shared photos can be accepted as attachments through Captures, but do not become standalone Timeline items.
- Current code stores pre-confirmation recordings in an `entries` IndexedDB store — resolved: these are domain **Captures** and should move to separate Capture storage as PWA/share-target work proceeds.
- No explicit Customer or Property entity exists in MVP. **Person** exists only as a contactable human, not a billing/account owner. Customer context is carried implicitly in Entry transcripts and surfaced via semantic retrieval. Proactive call-surface (Feature 3) is deferred post-MVP as it requires a richer contact/phone model.
