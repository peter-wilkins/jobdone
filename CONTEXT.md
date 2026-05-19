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
A real place the work happened at or is about, such as an address, site, venue, GPS-backed place, or remembered place label. Location is a first-class retrieval and filtering concept, not just a display label. Locations share one UX shape with a human-recognisable primary label, disambiguating secondary detail, and an optional map action when coordinates or an address are available. A Location may be address-backed, named-place-backed, or map-pin/approximate-area-backed.
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

**Co-occurrence Clue**:
A prediction clue derived from confirmed Entries where a Contact and Location appeared together before. It suggests likely structure during review but does not mean the Contact owns, lives at, manages, or permanently belongs to the Location.
_Avoid_: Customer-Location Relationship, Property Ownership, Contact Address

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

**Feedback Report**:
A user-submitted maintainer/agent triage artifact that something was confusing, broken, or worth improving. A Feedback Report can contain the user's voice/text description, optional attachments, and privacy-bounded Context Clues such as route, build id, device/browser state, recent app events, and recent errors. It is not a support-ticket conversation, CRM history, or user-facing work queue.
_Avoid_: Telemetry, Bug Video, Debug Dump

**Feedback Kind**:
The user-selected type of Feedback Report: bug, data loss, confusing, improvement, sync/login, share/install, performance, or other. Feedback Kind is a triage aid, not a product taxonomy exposed elsewhere.
_Avoid_: Support Category, Ticket Type, Label

**Request ID**:
An opaque random identifier attached to an API request so frontend diagnostics, Feedback Reports, and backend logs can be correlated without exposing user, session, device, Entry, Contact, Location, or payload identity.
_Avoid_: Correlation ID with user data, Trace Token

**Crash Report**:
A self-hosted automatic report created after a frontend error, unhandled promise rejection, startup failure, or service worker failure. A Crash Report is a compact diagnostic artifact, not a user-authored Feedback Report, and should avoid third-party crash tooling unless self-hosting proves insufficient.
_Avoid_: Third-party telemetry, User Complaint

**Native Integration Shell**:
A thin platform app whose purpose is to bridge OS capabilities such as sharing, install presence, notifications, and permissions into JobDone while the web app remains the product surface and source of domain behavior.
_Avoid_: Native Rewrite, Wrapper App, Second App

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
- Location identity can combine several pieces of evidence, such as a user-confirmed label, structured address, postcode, coordinates, provider place id, or approximate locality. The Location's kind describes the best current UX/acquisition type, not an exclusive data shape
- User-confirmed Location labels and addresses outrank provider-derived or GPS-derived fields. Lookup and GPS evidence can support suggestions, maps, and deduplication, but should not silently overwrite user-confirmed Location identity
- A deliberately confirmed approximate or remembered Location can become reusable before it has exact coordinates or a full address, but JobDone should treat it as weaker for deduplication and prediction until later strengthened with an anchor such as coordinates, postcode, provider place id, or structured address
- Strengthening an approximate Location with newly captured GPS, address, postcode, or provider evidence requires user confirmation. The review UX should phrase this in user language, such as asking "Are you here now?", rather than exposing deduplication or data-quality concepts
- Location deduplication should silently reuse an existing Location only on very strong identity evidence, such as the same provider place id, the same normalized postcode plus first address line, or a deliberately selected existing Location. Weaker similarities such as nearby coordinates or similar labels should be shown as reuse/merge suggestions rather than silently merged
- Custom Tags can be created from validated free text; custom Locations are created as real places; custom Contacts require deliberate contact creation and should not be inferred from name-only text alone
- Location and Contact are strongly encouraged during review but not required for Confirmation; their absence is meaningful data rather than invalid data
- Contacts are acquired at review/correction time, not through setup import. The user records naturally first; if JobDone misses the Contact, review offers correction paths such as existing Contacts, an OS contact picker where available, deliberate Contact creation, or leaving Contact blank
- Review distinguishes strong, medium, and weak structure evidence. Strong evidence can be preselected; medium evidence should be shown as an unselected suggestion; weak evidence stays hidden until the user asks to add structure
- Strong Contact evidence includes a shared vCard, trusted calendar attendee, or exact full-name match to an existing Contact. First-name-only matches are medium evidence at most and should not be preselected
- Strong Location evidence includes an exact known Location label/address in Entry text or a trusted Calendar Event location. Capture-time GPS near a known Location is medium evidence unless reinforced by Entry text or other Context Clues
- Location review should prefer reusing existing structure before creating new Locations. Suggested order is exact known Location from text/calendar, existing nearby Locations from GPS, Co-occurrence Locations from matched Contact, postcode/address lookup, "Are you here now?" map-pin capture, then manually named approximate Location
- When a Contact is matched, Locations previously confirmed with that Contact can appear as **Co-occurrence Clues**; when a Location is matched, Contacts previously confirmed with that Location can appear the same way. These clues are bidirectional and support prediction, but they do not create an independent Contact-Location relationship outside Entry history
- A Co-occurrence Clue can preselect a Location or Contact only when the matched counterpart has a repeated and clearly dominant confirmed association, with no contradictory evidence. One-off or ambiguous co-occurrence should be shown as an unselected suggestion
- Co-occurrence Clues are learned from confirmed Entry associations, regardless of whether the original Contact or Location association began as a prediction or a manual correction. Confirmation is the commit point
- Co-occurrence should be computed from confirmed Entry links first. A future derived stats/projection table may improve performance, but the domain should not expose a standalone Contact-Location relationship table in MVP
- Co-occurrence uses all confirmed Entry history, with recency as a ranking boost rather than a hard cutoff. Older associations remain useful unless newer evidence competes closely or contradicts them
- Co-occurrence candidates belong in the Prediction Candidate Set with source metadata such as `co_occurrence`, count, last seen time, and matched counterpart. Confidence and preselection remain deterministic application rules rather than LLM choices
- Explicit current-context clues such as Entry text, GPS, or Calendar Event evidence override historical Co-occurrence Clues for preselection. Conflicting co-occurrence can remain visible as an unselected suggestion if useful, but must not fight the user's current context
- Capture-time GPS can suggest a new Location but must not create one automatically. A new Location becomes real only through Confirmation; existing nearby Locations may be suggested more confidently than brand-new reverse-geocoded places
- Postcode, address, map, or provider lookup can return Location candidates but must not create a saved Location by itself. A lookup result becomes a Location only through user Confirmation in review or the Locations surface
- Missing Location or Contact is valid and should not be presented as an error. When predictions exist, show them inline; when no predictions exist, show compact `+ Location` and `+ Contact` correction controls while keeping Confirmation primary and unblocked
- JobDone can offer contextual prompts for optional sources after repeated friction, not during first-run setup. These prompts should explain how predictions are made and why the source helps, building trust by showing that JobDone is not silently invasive
- Optional source prompts should be tied to observed need, such as many Entries without Location, repeated manual Contact correction, or repeated calendar-like Entry text. Equivalent controls can also live passively in menu/settings
- Prediction review should use subtle source labels and tap-to-explain affordances rather than always-visible explanations. The user should be able to answer "why did JobDone suggest this?" without slowing normal Confirmation
- A dedicated Locations surface should behave like a first-class operational view, not a settings-only admin list. It should support search, map/address actions where available, lightweight cleanup for weak or approximate Locations, and a related Entry timeline for the selected Location
- Weak or approximate Locations can be surfaced as "Needs detail" work in the Locations view. This provides user value through cleanup and gives JobDone feedback on where Location capture is failing, without blocking capture or confirmation
- Location map actions should be platform-neutral in the UX, such as "Open in Maps". When coordinates exist, map actions should prefer coordinates plus the user-facing label; otherwise they can fall back to address search. Map provider interpretation is supporting evidence, not the source of truth for the user-confirmed Location identity
- The first Locations surface slice should cover list/search, Location detail with confirmed related Entry timeline, map/address actions where possible, a "Needs detail" path for weak Locations, and enough edit/strengthen behaviour to improve weak Location identity. Full map browsing, bulk merge, lookup history, and analytics are later concerns
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
- Calendar connection is a contextual upgrade offered after the user has seen value, not a first-run requirement. Calendar Events improve suggestions but the core capture flow must work without calendar access
- Calendar integration is deferred until capture-time Location clues and Contact correction are working. If added before a native shell exists, Google Calendar OAuth is the preferred first route because it works across web and devices
- Current device location can be captured at capture time as a Location Context Clue when permission exists or is granted in context. JobDone does not require background location history for MVP, and captured location remains review-only until Confirmation
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
- A **Feedback Report** contains user-submitted feedback content plus optional attachments and Context Clues; it is not a background telemetry stream
- Feedback Reports optimise for maintainer/agent triage and reproduction, not for user history, conversation threads, or support-ticket management
- Feedback Reports can be submitted without login when protected by server-side abuse controls such as rate limits. Login can attach Supabase `user_id` ownership context, but reporting bugs must not depend on a working login flow.
- Feedback Report identity is per-device before login and linked to the user's email/Supabase identity after login. Exact edge cases around later identity linking are less important than not losing useful reports.
- Feedback Reports use a small fixed triage taxonomy: Feedback Kind (`bug`, `data_loss`, `confusing`, `improvement`, `sync_login`, `share_install`, `performance`, `other`), impact (`blocked`, `degraded`, `annoyance`, `unsure`), and data loss (`yes`, `no`, `unsure`)
- The Feedback Report surface should start with quick triage controls for Feedback Kind, impact, and data loss before optional text or voice detail. Error bars and failed-flow screens can deep-link into Feedback Report creation with kind/surface preselected.
- Data-loss Feedback Reports are high-priority triage artifacts. They should not require extra user detail before sending, but should invite optional "what is missing?" detail, include local DB/sync counts and recent storage/service worker/API errors, avoid mutating local data during reporting, and retain sanitized local diagnostics longer than the normal rolling buffer.
- Raw Feedback Reports should not automatically create GitHub Issues. They should enter a maintainer/agent triage queue where duplicates can be grouped, private details can be redacted, and actionable reports can be promoted into GitHub Issues deliberately.
- Agent-facing Feedback Report triage should present a normalized factual record with kind, impact, data loss, build id, route/surface, identity class, created time, recent Request IDs, backend health, sync/local DB counts, recent sanitized events/errors, user description, dedupe signature, and suggested next action. Any AI-written summary or diagnosis must be labelled as a suggestion, not truth.
- Feedback Report improvements should be delivered as tracer-bullet slices: Request IDs and API diagnostics first, anonymous submission with rate limiting next, fast triage UI next, self-hosted Crash Reports next, and an agent triage queue after enough report data exists.
- Frontend API calls should include a random opaque **Request ID** header. The backend accepts valid frontend Request IDs or generates its own, logs the Request ID with method, route, status, and error kind, and Feedback Reports include recent Request IDs so maintainers and agents can search production logs.
- Anonymous Feedback Report and Crash Report rate limits should be server-enforced using abuse keys derived from IP hash, user-agent hash, route type, and optionally build id. A client-side per-device feedback id can group reports diagnostically but must not be trusted as the only limiter key. Data-loss reports can bypass strict client throttles but not server abuse guards.
- Feedback Report Context Clues exclude private Entry content, transcripts, Contact details, and shared payload bodies by default unless the user explicitly includes them
- Crash Reports should be self-hosted by default, sent automatically when compact privacy-bounded crash context is available, and surfaced with a small non-blocking error/status bar rather than a permission prompt or modal
- Crash Reports can include crash id, build id, route, timestamp, error name/message, trimmed stack, known surface/component, recent Request IDs, recent sanitized app events, browser/device/install mode, and online/backend status. They must exclude Entry content, Capture payloads, Feedback text/audio, Contact details, Location labels/addresses, transcripts, auth/session data, raw API bodies, localStorage dumps, and IndexedDB dumps. Crash submission should be rate-limited per device/build/error signature to prevent loops.
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
- A **Native Integration Shell** is only worth prototyping if native OS integration solves concrete PWA pain such as unreliable share targets; App Store / Play Store discoverability alone is not enough justification for MVP
- JobDone should have one recommended installed surface per platform. If an Android Native Integration Shell becomes viable, it should be the recommended Android install path; the browser-installed PWA remains the desktop/default web path
- Chrome's Add to Home Screen install route may feel unfamiliar or less trustworthy than an app-store install flow for some users, but that is an adoption concern rather than a reason to build a second product surface
- Share Target is an install-gated value proposition: users generally need JobDone installed before it appears as an Android share option, so install promotion should happen near login/onboarding or in the app menu, not after a successful share
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
