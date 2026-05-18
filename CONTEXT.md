# JobDone

A mobile-first voice log for self-employed tradespeople that externalises operational memory — capturing what happened on a job and surfacing it at the moment it's needed.

## Language

**Capture**:
Raw inbound material awaiting review — voice, text, shared contact, photo, or link — that may become an Entry, Contact update, or both after Confirmation.
_Avoid_: Draft, Item, Import, Upload

**Entry**:
A confirmed submission to the Timeline, timestamped and fully immutable once confirmed. Corrections are made by submitting a new Entry.
_Avoid_: Event, Job, Note, Recording, Log

**Contact**:
A contactable real human known to the user, anchored by contact evidence such as a phone number, email address, shared vCard, or trusted calendar attendee. A Contact is familiar mobile-address-book language and does not imply billing ownership.
_Avoid_: Customer, Client, Account, Person

**Location**:
A real place the work happened at or is about, such as an address, site, venue, GPS-backed place, or remembered place label. Location is a first-class retrieval and filtering concept, not just a display label.
_Avoid_: Property, Site, Address-only

**Calendar Event**:
A real calendar item near the time of a Capture or Entry, used as contextual evidence for prediction and review. Calendar Events can suggest likely Location, Contact, or Tags, but are not themselves Entries.
_Avoid_: Appointment Entry, Job, Booking

**Context Clue**:
External or inferred evidence used to predict Location, Contact, or Tags for an Entry. Context Clues support review and prediction but are not themselves Timeline content.
_Avoid_: Metadata, Signal, Evidence

**Tag**:
A user-visible label attached to Entries for filtering, recall, and future prediction. Tags are how JobDone structures operational memory; they are not decorative UI facets.
_Avoid_: Label, Chip, Metadata

**Tag Category**:
The kind of Tag, such as Location, Contact, work type, status, or user/domain-specific categories. Tag Categories define the filtering facets and prediction slots the UX encourages.
_Avoid_: Facet, Group, Namespace

**Tag Prediction**:
A suggested Tag inferred from Entry content, context, or prior user Tags, shown for quick Confirmation or removal before an Entry is committed.
_Avoid_: Auto-tag, AI Guess

**Tag Vocabulary**:
The user's reusable set of Tags available for future prediction. It is managed from confirmed use, recent use, rejection history, and safe custom Tag creation; it is not the full raw history of every Tag ever typed.
_Avoid_: Tag History, Prompt List

**Prediction Candidate Set**:
The bounded set of plausible Locations, Contacts, and Tags selected from Context Clues and Tag Vocabulary before AI ranking. The AI chooses from this small contextual set and may propose a new Tag only when no candidate fits.
_Avoid_: Full Tag List, Prompt Context, Search Space

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

**Share Pack**:
A user-curated subset of Recall-returned Entries, optionally with a short user-written message, prepared as a revocable share link for an external recipient. The user selects each Entry explicitly; a Share Pack is not the Query itself, not all Recall results, and not an AI-generated answer. It is a snapshot of selected Entry content at send time, not a live view into the Timeline.
_Avoid_: Report, Export, Search Result

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
- A **Capture** is committed only through Confirmation, producing an Entry, a Contact update, Location association, Tags, or some combination
- Predicted Locations, Contacts, Tags, and Context Clues remain review-only until Confirmation
- Confirmed Entry associations to Locations, Contacts, Tags, and Context Clues are immutable in MVP; corrections are made by submitting a new Entry
- Confirmation does not require login; confirmed local data syncs after login when available
- Shared contacts, photos, links, and text always enter as **Captures** and require Confirmation before becoming Entries
- One OS share action creates one **Capture**, even when it contains multiple payloads
- The **Inbox** persists Captures locally, including offline shared Captures, until Confirmation or Rejection
- Captures are local-only before Confirmation; only confirmed outcomes sync
- A **Capture** is created only after all required payloads are stored locally; partial Captures are not valid
- Unsupported payloads cause the whole shared Capture to fail before creation in MVP
- First PWA/share-target implementation slice is app-shell installability plus text/link shared Captures; Photos and vCard/Contacts follow
- A **Contact** can be referenced by Captures and Entries, but does not imply billing ownership or a Customer model
- Sharing a contact creates or updates a deduplicated **Contact** and creates a **Capture** that references that Contact
- vCard is the canonical shared contact payload; text-only contact shares are parsed best-effort and reviewed
- **Contact** deduplication uses normalized email or normalized phone number per user; names alone never deduplicate Contacts
- **Contacts** are local-first and sync to Supabase eventually, using the same per-user normalized identifier rules
- **Locations**, **Contacts**, and **Tags** are primary retrieval structure for Entries, not secondary decoration
- **Locations** and **Contacts** use the same pill/filter UX as Tags but remain separate domain entities because they carry identity and context beyond a string label
- New Locations and Contacts require stronger evidence than arbitrary Tags: Locations should refer to real places, and Contacts should refer to contactable humans with contact evidence
- Custom Tags can be created from validated free text; custom Locations are created as real places; custom Contacts require deliberate contact creation and should not be inferred from name-only text alone
- Location and Contact are strongly encouraged during review but not required for Confirmation; their absence is meaningful data rather than invalid data
- Reminder or to-do-like workflows are Recall/query views over Entries in MVP, not a separate Task model
- Filterable operational structure belongs in Locations, Contacts, or Tags; narrative memory belongs in Entry content
- Materials, labour time, follow-ups, possible future work, invoicing status, and similar workflow flags are Tags or Tag Categories in the core model, not structured Entry fields
- **Context Clues** explain or improve predictions; they can include candidate Locations, Contacts, Calendar Events, device context, and recent user activity, but confirmed Locations and Contacts are Entry associations rather than generic Context Clue records
- Context Clues are primarily visible during review; after Confirmation they are retained only where useful for explainability, debugging, or prediction quality, not as normal Timeline content
- **Tag Vocabulary** supplies reusable candidate Tags for prediction, but stale, repeatedly rejected, or one-off Tags should be suppressed
- A **Prediction Candidate Set** is built before AI prediction so the model sees only plausible contextual options, not the user's entire Tag Vocabulary
- **Tag Categories** shape prediction and filtering, but MVP does not expose full taxonomy management to users
- Tag prediction uses a domain template plus the user's Tag Vocabulary; users grow vocabulary through confirmed use but do not manage full category schema in MVP
- **Calendar Events** are stored as minimal Context Clue snapshots for Entries, not as a full mirrored calendar
- **Recall** returns Entries only; linked Contacts, Locations, and Tags can improve matching but are not returned as Timeline results
- A **Share Pack** contains only user-selected Recall-returned Entries and optional user-written context
- A **Share Pack** includes Entry summaries and dates by default; materials, labour time, follow-ups, and possible future work are optional shared fields
- Transcripts are excluded from MVP Share Packs because they may contain incidental personal data
- A **Share Pack** never grants access to the Timeline, Contacts, Queries, audio blobs, or future Entries
- Share Packs are shared link-first in MVP so the user can send them through WhatsApp, SMS, email, or another native share channel
- Creating a Share Pack requires login because the link is cloud-backed and must be owner-revocable
- Visible Recall results enter Share Pack preview selected by default; the user removes sensitive Entries before creating the share link. Hidden, unloaded, or future matches are never auto-selected.
- Share Pack links use unguessable tokens, expire after 7 days by default, can be revoked, and expose only the Share Pack snapshot
- Expired, revoked, missing, or invalid Share Pack links show the same neutral unavailable message and never reveal whether a specific Share Pack existed
- Share Pack ownership is server-side link context for revocation and audit; the recipient-facing MVP does not need to display sender identity
- Share Pack recipients view the snapshot in-browser for MVP; PDF/download/export is deferred
- Recipient-facing Share Pack pages avoid third-party embeds and unnecessary tracking
- Share Pack access does not create recipient-facing read receipts in MVP; operational access metadata is only for abuse/debug if needed
- Share Pack recipients are arbitrary external recipients for MVP; sharing a link does not automatically create a Contact
- A Contact-only Confirmation updates Contacts and removes the Capture from the Inbox without creating a Timeline Entry
- A minimal Contacts surface lists, searches, and displays Contacts; merge and full editing are deferred
- A Contact with no linked Entries can be deleted; a Contact linked to Entries cannot be deleted while immutable Entry snapshots remain
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
- JobDone is an operational log, not a data-curation workspace; the UX should encourage quick Confirmation rather than ongoing taxonomy maintenance

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
- No explicit Customer or Property entity exists in MVP. **Contact** exists only as a contactable human, not a billing/account owner. **Location** covers where work happened or is about without implying property ownership. Customer context is carried through Contacts, Locations, Tags, and Entry summaries rather than a Customer account model.
