# JobDone

A mobile-first voice log for self-employed tradespeople that externalises operational memory — capturing what happened on a job and surfacing it at the moment it's needed.

JobDone is the product surface. Teams, Backlogs, Claims, Share Packs, and Approval Requests are shared primitives inside JobDone that can support business crews, households, apprentices, customer approvals, and solo use.

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
External or inferred evidence used to predict Entry structure such as Location, Contact, Tags, or Team-configured Work Context for an Entry. Context Clues support review and prediction but are not themselves Timeline content.
_Avoid_: Metadata, Signal, Evidence

**Capture Context**:
Bounded, user-controlled context that helps JobDone summarize, extract, and predict structure for a Capture. Capture Context can come from a personal onboarding answer, a Team purpose/domain, claimed Backlog Items, Work Context, or future domain profiles. Capture Context is data about what the user is likely doing; it is not raw prompt text or model instructions.
_Avoid_: Prompt, Prompt Injection, Product Mode

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
The bounded set of plausible Locations, Contacts, Tags, and Team-configured Work Context values selected from Context Clues, Team settings, and Tag Vocabulary before AI ranking. The AI chooses from this small contextual set and may propose a new Tag only when no candidate fits.
_Avoid_: Full Tag List, Prompt Context, Search Space

**Pre-Extraction**:
A behind-the-scenes extraction pass run before Confirmation to help JobDone make good Context Clue guesses from the raw Capture, nearby device/platform evidence, and existing user data. Pre-Extraction is advisory: it can suggest or rank review options, but it is not saved as the final Entry structure. Pre-Extraction should be lazy and deterministic-first in MVP: keyword matching, existing candidate names, and cheap rules should be tried before any LLM fallback.
_Avoid_: Hidden Confirmation, Auto-Save, Final Summary

**Clean Up Text**:
An optional review action run after the user has twiddled review context such as Location, Contact, Tags, Work Context, or Backlog Item. Clean Up Text uses the confirmed/reviewed Capture Context to improve the user-visible Entry text, including Markdown formatting, bullet points, deduplication, and clearer wording. It may remove duplication already captured in user-set context, such as repeating a selected Contact in the Entry text. It must not overwrite Context Clues or Work Context values the user has already set.
_Avoid_: Final Extraction, First Guess, Background Suggestion, Raw Transcript

**Local Transcription**:
A phone-capable transcription path that turns Capture audio into reviewable text without requiring the backend at that moment. Local Transcription is a product capability: lazy loading, cache status, fallback behaviour, dogfooding metrics, and weak-connectivity UX.
_Avoid_: Runtime-only Spike, Backend Transcription Replacement

**Transcription Runtime**:
The concrete self-hosted technology used to perform Local Transcription, such as upstream whisper.cpp WebAssembly or a Rust/WASM runtime. The Runtime is replaceable; it sits behind the Local Transcription seam and may fail independently of the product-level Local Transcription workflow.
_Avoid_: Product Mode, Capture Flow

**Transcription Source**:
The visible provenance of a Capture transcript, such as local, backend, fallback-to-backend, or evaluation race. Transcription Source helps dogfooding and debugging; it should be visible near the review text for a Capture and may also appear in lightweight app status when testing Local Transcription.
_Avoid_: Hidden Provider Choice, Debug-only Log

**Co-occurrence Clue**:
A prediction clue derived from confirmed Entries where a Contact and Location appeared together before. It suggests likely structure during review but does not mean the Contact owns, lives at, manages, or permanently belongs to the Location.
_Avoid_: Customer-Location Relationship, Property Ownership, Contact Address

**Work Context**:
A Team-configured Entry structure dimension that captures what the work belongs to for that Team, beyond global Location, Contact, and Tags. Examples include Backlog Item, Machine, Vehicle, Asset, Project, or another Team-specific operational object. Work Context should use Team language and settings, not product-specific words such as chore.
_Avoid_: Chore Field, Generic Metadata, Team Tag

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
A user-curated subset of Entries, optionally with a short user-written message, prepared as a revocable share link for an external recipient or as the evidence portfolio for an Approval Request. The user selects each Entry explicitly; a Share Pack is not the Query itself, not all Recall results, and not an AI-generated answer. It is a snapshot of selected Entry content at send time, not a live view into the Timeline.
_Avoid_: Report, Export, Search Result

**Instruction**:
Guidance attached to a Backlog Item that explains how to do the work well. An Instruction can be plain text and may optionally reference a Share Pack when examples, previous Entries, or richer context would help.
_Avoid_: Evidence, Approval Request, Task Description Only

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

**Approval**:
An authorised reviewer gesture that accepts a confirmed Entry or submitted work for an external outcome such as customer sign-off, apprentice review, child reward, payment, or access changes. Approval is separate from Confirmation: Confirmation means the creator says the Entry is ready and true; Approval means another authorised person accepts it.
_Avoid_: Confirmation, Save

**Approver**:
The authorised reviewer who can approve or reject submitted work for an external outcome. An Approver may be a parent, customer, manager, tradesperson, or other trusted reviewer; the role should not imply a specific family or business relationship.
_Avoid_: Parent-only, Customer-only, Manager-only

**Approval Request**:
A request for an Approver to review one or more confirmed Entries and decide whether they satisfy an external outcome. Approval Requests sit above Entries: the Entry remains the immutable source of what was done, while the Approval Request carries reviewer state and outcome.
_Avoid_: Task, Ticket, Job

**Approval Outcome**:
The result unlocked or recorded when an Approval Request is approved, such as reward points, money, customer sign-off, payment eligibility, or simple acceptance. Approval Outcome is the generic term; product-specific outcomes can add detail later.
_Avoid_: Payment-only, Prize-only

**Reward**:
A Team Member-facing Approval Outcome such as points, money, or another benefit earned after approved work. Reward is one kind of Approval Outcome, not the approval decision itself.
_Avoid_: Approval, Payment-only

**Points**:
An optional Approval Outcome unit enabled by a Team setting and earned through approved work. Points are useful for family/habit teams, progress goals, bonuses, and privilege thresholds, but should be absent from Teams that only need sign-off or ordinary work tracking.
_Avoid_: Score, Coins, Credits

**Reward Option**:
An allowed Reward a Team Member may choose before submitting work for approval. The Team constrains available Reward Options; the chosen Reward Option becomes an Approval Outcome only if the Approval Request is approved.
_Avoid_: Prize Menu, Payment Request

**Progress Goal**:
A Team target based on earned Points in a week. Progress Goals help Team Members see weekly progress and can unlock Bonuses when met.
_Avoid_: Streak-only, Task Count

**Bonus**:
An extra Reward granted when a Team Member reaches a Progress Goal, such as a point threshold. Bonuses are separate from the base Reward attached to an approved Backlog Item.
_Avoid_: Base Reward, Approval

**Privilege Threshold**:
A Team point threshold used to communicate externally managed consequences, such as losing privileges when minimum points are not met. JobDone can track and display the threshold, but does not enforce the privilege itself in V1.
_Avoid_: Device Restriction, Automatic Lock

**Routine**:
A finite habit-building plan that suggests repeated Backlog Items for a period of time, such as brushing teeth daily for three weeks. A Routine exists to help instil behaviour, not to create permanent approval admin.
_Avoid_: Forever Recurring Task, Streak Contract

**Backlog**:
An ordered list of requested or intended work before evidence exists. A Backlog is not the Timeline; it represents work to consider or complete, while the Timeline remains the record of confirmed Entries.
_Avoid_: To-do List, Task List, Job List

**Backlog Item**:
One requested or intended piece of work on a Backlog. A Backlog Item can later be satisfied by one or more confirmed Entries and reviewed through an Approval Request, but it is not itself evidence that work happened.
_Avoid_: Task, Job, Ticket

**Claim**:
A Team Member's temporary responsibility for a Backlog Item they have chosen to do. A Claim prevents accidental duplicate work but does not prove work happened; evidence still comes from confirmed Entries. Approval clears or completes the Claim.
_Avoid_: Ownership, Assignment, Reservation

**Team**:
The shared operating group where users, Backlogs, Entries, Approval Requests, Approvers, and outcomes live. A Team can be a one-person tradesperson setup, a business crew, a household, or another collaboration group; it does not imply a legal organisation or billing account.
_Avoid_: Organisation, Account, Tenant, Household-only

**Team Member**:
A person's membership in a Team. Team Member is separate from User identity and Device identity: the same person can use multiple devices, and a User can belong to multiple Teams with different capabilities.
_Avoid_: User, Device, Person record, Role

**Team Owner**:
The Team Member who created or owns the Team and can change Team settings, invite people, and manage Team-level configuration. V1 keeps this as a single-owner model rather than a permission matrix.
_Avoid_: Admin Role, Parent, Manager-only

**Team Worker**:
An invited Team Member using My Work. Team Workers can claim Backlog Items and submit work across the Teams they belong to.
_Avoid_: Child, Employee, Assignee-only

**Team Edit View**:
The Team Owner configuration surface for naming the Team, inviting Team Members, choosing Team settings such as whether Points are enabled, and managing open Backlog Items. Team Edit is not the urgent approval queue.
_Avoid_: Parent View, Admin View, Approval Queue

**Team Review View**:
The Team Owner operational review surface for submitted Approval Requests that need a decision. Team Review is time-sensitive work and should float submitted work above slower Team configuration.
_Avoid_: Team Setup, Team Edit, Admin Settings

**Team Home View**:
The Team Owner hub for day-to-day Team work. Team Home puts Needs Review first, with lightweight access to creating Backlog Items and editing Teams without hiding those actions in the burger menu.
_Avoid_: Team Setup, Admin Dashboard, Settings-only View

**My Work View**:
The Team Member-facing surface for doing work across all Teams they belong to: claimed/in-progress items first, open Backlog Items next, and submitted/done history after that. Items retain their Team context internally and may show a small Team label when useful.
_Avoid_: Child View, Employee View, Single-Team Work Screen

**Team Invite**:
An email-based invitation to join a Team. A Team Invite exists before a Team Member is created; accepting the invite links a User/email/device into the Team and creates the Team Member. Invite links should support frictionless login where possible.
_Avoid_: Product Invite, Manual Account Setup

**Auto-Approval**:
A Team setting where submitted work is approved immediately by policy instead of waiting for a manual Approver decision. Auto-Approval still creates an Approval Request and still requires evidence; it records that the Team chose trust/coordination over manual review.
_Avoid_: No Approval, Skipping Evidence, Silent Completion

**Team Template**:
A suggested starting configuration for a new Team, such as High Trust Team, Low Trust Team, or Family Team. Templates set initial Team settings without creating separate product modes.
_Avoid_: Product Type, Mode, Segment Lock-in

**Product Module**:
Deferred concept for a future multi-product shell. JobDone V1 should not need Product Modules; Teams configure capabilities such as Points instead of switching between products.
_Avoid_: Mode, Feature Flag, App Toggle

**Product Invite**:
Deferred concept for a future multi-product shell. JobDone V1 invites are Team Invites.
_Avoid_: Generic Invite, Login Link

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
- A voice recording creates a **Capture**; transcription produces reviewable text before the user chooses Context Clues, Work Context, or Team-linked Backlog Items
- A first-run onboarding step should ask what the user will mostly use JobDone for, such as tracking work for customers as a plumber, recording work on vehicles as a mechanic, or gardening at home. This creates the user's default personal **Capture Context** without forcing them into a fake Team.
- JobDone may use extraction on the onboarding answer to create bounded prompt guides and default Capture Context, but user-provided text must be treated as domain data, not as executable instructions to the model.
- Pre-Extraction can run behind the scenes before review to make good guesses for Context Clues and Prediction Candidate Sets. It should run lazily when suggestions are needed, not automatically as a blocking step after every transcription.
- Deterministic Pre-Extraction should be phone-capable/client-side where possible. This keeps review snappy, supports offline/local mode, and pairs well with future on-device transcription such as whisper.cpp. Online Clean Up Text can happen later when connectivity returns.
- Local Transcription is a local-mode product capability, not a specific runtime choice. It owns lazy loading, cache status, backend fallback, dogfood UX, and weak-connectivity behaviour. Transcription Runtime work owns whether JobDone can legally and practically self-host the underlying WASM transcription engine.
- Transcription Source should be visible during dogfooding, especially in Entry review. Users and agents should be able to tell whether text came from Local Transcription, backend transcription, fallback-to-backend, or an evaluation race.
- JobDone may occasionally race Local Transcription and backend transcription to compare latency and quality, but racing is an evaluation mode, not the default user path. The long-term preference is high-quality Local Transcription with backend fallback for unexpected failures.
- On-device transcription is not a dependency of Pre-Extraction. If a phone-capable transcription path works without hurting page load, JobDone can support weak-connectivity Capture as Local Transcription -> local Pre-Extraction -> local Confirmation -> later sync, with online Clean Up Text deferred.
- Pre-Extraction should have a property-test feedback loop. Generated Captures, candidate Contacts/Locations/Backlog Items, and expected matches should prove that deterministic rules make useful suggestions without inventing durable structure, and failing cases should shrink to a small readable repro.
- Clean Up Text should normally happen after the user has twiddled review context, because JobDone may not know whether the Capture is personal work, Team work, family work, or another mode until the user selects a Work Context or Backlog Item.
- Clean Up Text is optional. Users who are happy with the text can confirm without waiting for more AI. Clean Up Text may make the message more readable, add Markdown structure such as bullet points, and reduce repeated details already captured by user-set context, but user-set context remains authoritative.
- The preferred Capture flow is: transcription -> Pre-Extraction guesses -> Context Clue and Work Context twiddling -> optional Clean Up Text using the selected Capture Context -> Confirmation.
- A **Capture** is committed only through Confirmation, producing an Entry, a Contact update, Location association, Tags, or some combination
- Predicted Locations, Contacts, Tags, Work Context, and Context Clues remain review-only until Confirmation
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
- **Locations** and **Contacts** remain special first-class entities because they have phone and platform integrations such as GPS, maps, share contacts, contact evidence, and future contact pickers. A Team may hide Location and/or Contact review controls when they are not useful for that Team, such as a Team that always works in one place.
- **Work Context** covers Team-specific operational dimensions that should sit beside Location, Contact, and Tags during review without inheriting Location or Contact identity rules. Team settings choose which Work Context dimensions are active for that Team.
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
- **Recall** correctness is grounded in Entry source IDs and explicit exclusions, not generated answer text
- SQL-first **Recall** V1 searches Entry summaries and confirmed Contact, Location, and Tag labels; transcripts remain source/debug material rather than matching truth
- SQL-first **Recall** V1 uses deterministic token/phrase matching before Postgres full-text search or vector reranking
- Current **Recall Property Testing** work is focused on the developer feedback loop, not user-facing Recall explanation UI
- The next **Recall Property Testing** slice uses local Supabase, generated cases, and shrinking against the production SQL-first Recall path
- A **Share Pack** contains only user-selected Recall-returned Entries and optional user-written context
- An **Approval Request** uses a Share Pack as its evidence portfolio. The Share Pack carries the selected Entry snapshot; the Approval Request adds reviewer intent, state, decision, and outcome.
- When a claimed Backlog Item is submitted, JobDone auto-creates the Approval Request's Share Pack from Entries linked to that Claim, then shows a quick edit/confirmation step before submission.
- V1 uses one Approval Request per Backlog Item. Bundled approvals are deferred because they complicate partial approval, Points, and "needs more evidence" state.
- An **Approval Request** may reference a Backlog Item, but does not always have to. Self-started work is allowed by default so Team Members can show initiative, while a Team setting can require Approval Requests to be backed by a Backlog Item when the Team wants consensus on acceptable use of time.
- Approval is a shared core workflow. Team settings decide whether Approval Requests require manual review or are auto-approved when submitted. Team-specific outcomes sit on top: a family Team can use Points and reward balances; a work Team can use customer sign-off or payment/admin notes.
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
- Personal Timeline sync and Team queue refresh are separate freshness loops. Personal Timeline, Contact, Location, and Query sync runs for local-first personal data; Team Review and My Work refresh server-backed Team queues when the user enters or refocuses Team surfaces. Later push notifications can improve this, but they should be opt-in and are not required for correctness.
- If a Team Review or My Work refresh fails, JobDone should keep the last visible Team queue and show a small network/stale-state strip rather than blanking the surface. This mirrors personal Timeline network behaviour: carry on, but make backend freshness visible.
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
- JobDone V1 should build a generic Team layer rather than a separate family/kids product. A family Team, work Team, apprentice Team, and solo Team are all Teams with different settings.
- Team language should be introduced now, but Team management UI should not exceed what the Backlog or Approval slice needs. Implement only the smallest Team-shaped schema/backend needed for the first collaboration workflow, then let Team capabilities grow from real use.
- The first collaboration tracer bullet should be a dogfoodable Team workflow with Team creation, Backlog Item creation, lightweight Approval Request review, followed by My Work for claiming and evidence flow.
- The first Team implementation slice can use text-only Backlog Items and text-only submitted evidence. Photos, richer Share Pack editing, and complex instruction support can follow after the Backlog/Approval loop works.
- The first Team UI can assume one invited Team Worker for dogfooding, while the underlying Team model should remain capable of multiple Team Members. Backlog Items are not assigned; Team Members claim work when they choose to do it.
- The first Team Backlog should be an Open Backlog only. Dates, weekly scheduling, and Routine generation follow after the Backlog/Approval loop works.
- Slice 1 Backlog Item creation needs only a description and Points. Description is the simple Backlog Item field for this slice; richer Instructions remain optional later. Titles, assignment, due dates, recurrence, reward choice, photos, and Share Pack-backed Instructions can follow when real use proves the need.
- Team Review and Team Edit should be separate surfaces: Team Review handles submitted Approval Requests that need a decision, while Team Edit handles Team configuration, invites, settings, and open Backlog management.
- The Teams area should default to Team Edit only when the user owns no Teams yet. Once a user owns at least one Team, the Teams area should default to Team Home because day-to-day owner work includes review, quick Backlog creation, and occasional Team editing.
- Team Review's active queue shows submitted Approval Requests and needs-more-evidence items oldest first. Closed decisions can appear below as lazy-loaded recent history, but they should not compete with active review work.
- The burger/menu label for the owner-facing Teams area should be **Team**. Inside Team Home, the main section is **Needs Review**, with obvious secondary actions for **Add Backlog Item** and **Edit Teams**. These owner actions should not rely only on the burger menu or awkward floating controls.
- Team Home should support quick inline Backlog creation. **Add Backlog Item** expands a compact form in place, saves the new item, then collapses while keeping the owner on Team Home. Team Edit remains the slower configuration surface, not the normal path for day-to-day Backlog capture.
- Team Home should keep Team context visible. If the owner has multiple Teams, a compact Team selector appears near the top. Inline Backlog creation uses the selected Team; Edit Teams opens configuration for the selected Team. The selector should default to the Team related to the current review item when there is one, otherwise the most recently used or first owned Team.
- Team Home's Needs Review list should aggregate submitted work across all owned Teams by default, oldest first. Each review item carries a small Team label, matching My Work's team labels, so urgent work is not hidden behind a filter. Filtering by Team can follow later if the list gets noisy.
- Team Owners can edit a Backlog Item's description and Points, or delete it, only while it is open. Once a Backlog Item is claimed or submitted, V1 avoids edit/delete and uses the approval flow or a new Backlog Item instead.
- My Work should be ordered as a simple work queue: claimed/in-progress items at the top, open Backlog Items in the middle, and done/history items at the bottom.
- Submitted-but-not-yet-approved items stay in the claimed/in-progress section with a submitted status rather than moving to a separate pending section.
- Items marked needs-more-evidence stay in the claimed/in-progress section with the same Claim. The Team Member adds more evidence and resubmits rather than starting over.
- The done/history section in My Work shows this week's finished items and total approved Points for the week when Points are enabled. Full history and lazy loading can follow later if real use needs it.
- Search/filter across claimed items, open Backlog Items, and history is deferred until dogfooding shows the lists are noisy enough to need it.
- A **Backlog Item** can include an **Instruction**. Instructions start as plain text, but can later reference a Share Pack when a reusable bundle of examples, previous Entries, photos, or context helps explain complex work.
- Team evidence is user-written text plus encouraged Photos. Photos remain attachments on Captures/Entries; text explains what was done. Photo evidence is not required because some valuable work is abstract or hard to photograph. Approval Requests review those Entries through a Share Pack rather than introducing a Team-specific evidence object.
- Teams do not require objective proof before approval. Trust is between the Team Member and Approver; the app records the submitted Entry evidence and approval decision, while "needs more evidence" gives the Approver a lightweight way to ask for more.
- My Work can suggest recent personal Timeline Entries as possible evidence inside the submit box for a claimed Backlog Item. Suggestions are optional picks based on the Backlog Item title/description and recent Entries; JobDone must not auto-submit evidence without the Team Member choosing it.
- Capture review stays personal and frictionless by default. When the user is attaching evidence to Team work, JobDone can first ask for the Team if there is more than one relevant Team, then show that Team's claimed Backlog Items so the user can pick one or more Work Context values. If there is only one relevant Team or one strong claimed Backlog Item candidate, the UI should skip or preselect that step.
- Entry review is the main place to link evidence to claimed Backlog Items. My Work can still offer submit-evidence shortcuts, but the normal Capture path should let the user confirm content and attach it to Team Work Context before the Entry is committed.
- If the user has no Teams and belongs to no Teams, Entry review should hide Team Work Context controls completely.
- If the user belongs to Teams but has no claimed Backlog Items, Entry review can show a compact Work Context doorway. Opening it should promote claiming an existing open Backlog Item first, because planned Team work should stay intentional. A secondary create-and-claim path should remain easy where Team settings allow self-started work, because users may only realise during review that the work was not already on the Backlog.
- Create-and-claim from Entry review should not require a separate pre-approval step in V1. If Team settings allow self-started work, the new Backlog Item is created, claimed, and linked to the current Entry; the normal Approval Request later decides whether the work counts and whether Points are granted. If Team settings disallow self-started work, the create-and-claim option is hidden or disabled so the Team Member talks to the Team Owner instead.
- If the user is not doing Team work, the Capture can still become a normal personal Entry. Team evidence can be assembled later by manually linking existing Entries or by creating self-started work where Team settings allow it.
- The first implemented Work Context dimension for Teams should be **Backlog Item**. Claimed Backlog Items already connect to Claims, Approval Requests, and Share Pack evidence, so they give the smallest useful feedback loop. More generic custom dimensions such as Machine, Vehicle, Asset, or Project can follow after Backlog Item evidence linking is working.
- Teams with Points enabled should include visible Progress Goals: Team Members can track earned points against targets, earn Bonuses for reaching targets, and see minimum Privilege Thresholds. Privilege consequences are managed outside the app in V1; JobDone tracks and communicates them but does not enforce them.
- Teams can support habit-building through finite Routines that suggest repeated Backlog Items for a limited period, then stop when the behaviour is likely established or the approval burden outweighs value.
- JobDone should help Team Owners create useful Routines by suggesting sensible habit-building patterns, rather than forcing them to invent every repeated Backlog Item from scratch.
- Routine-generated Backlog Items still use the normal approval flow every time in V1. Approval should remain lightweight so repeated habit work does not become admin-heavy.
- JobDone should discourage Team Owners from creating too many new Backlog Items or Routines at once. Habit-building works better when the Team Member can focus on one new routine for a period, such as adding a recurring Backlog Item every few weeks rather than flooding the Backlog.
- Teams with Points enabled have base Points on Backlog Items using a simple 1-10 scale so different work can be worth different amounts before it is claimed. Approval grants the Backlog Item's Points.
- Team Owners set Points when creating or editing Backlog Items. For self-started work without a Backlog Item, the Team Member can suggest Points, but the Approver confirms or adjusts the Points when approving.
- A **Backlog** belongs to a Team. Backlog Items are pull-based by default: Team Members choose what they feel ready to do rather than being assigned work by default. Future permission or eligibility rules may restrict who can do certain Backlog Items, but that is deferred.
- A **Backlog Item** can be claimed by a Team Member before work starts. Claiming prevents accidental duplicate work and makes the member responsible for finishing or releasing it. In V1, a claim clears when the related Approval Request is approved; explicit release/reassign behaviour can follow.
- A rejected Approval Request should mean "needs more evidence" rather than reopening the Backlog Item or releasing the Claim. The Claim stays with the Team Member, no Points are awarded yet, and the Team Member can add evidence and resubmit. My Work therefore needs both available Backlog Items and claimed/in-progress Backlog Items.
- V1 Backlog Item states are `open`, `claimed`, `submitted`, `needs_more_evidence`, and `approved`. Release, reassignment, cancellation, and archival can come later if real use requires them.
- A **Team Invite** is created before a **Team Member** exists. Mistyped, expired, or ignored invites should not create active members or assignable people. Accepting an invite can use a frictionless auth link that both signs in or links the email identity and creates the Team Member.
- V1 Team Invite emails should behave like magic links: clicking once signs the invitee in as the invited email and returns them to JobDone to accept the invite. If the browser is already signed in as another email, the invite auth link wins and switches the session to the invited email. Do not build multi-email aliasing or composite Team identity in V1.
- Creating a Team Invite sends a Supabase Auth email to the invited address. The copied invite URL remains a fallback/debug link, but normal acceptance should happen through the email so the invitee is signed in as the invited address before acceptance.
- Team Invite copy should be generic, such as "Join [Team Name] on JobDone", regardless of whether the recipient already has a JobDone account. The backend may know or check account existence when generating auth links, but the product should not reveal that distinction to the Team Owner or invitee.
- V1 can use whichever Supabase Auth link type is simplest for one-click invite acceptance. Try the invite link type first; fall back to magic link if that is simpler. Product behavior is the same either way.
- After a Team Invite link signs the invitee in, acceptance should happen automatically and land the invitee in My Work. Do not add a separate "Join Team" confirmation screen in V1.
- Pending Team Invites should not expire in V1. They remain live until accepted or explicitly revoked/deleted.
- Accepted Team Invite links are durable re-entry links for the invited identity while the Team Member still exists. Clicking an already accepted invite should sign in or verify the invited email again and land in My Work, instead of showing a dead-link message.
- Revoked, missing, invalid, or accepted-for-a-different-identity Team Invite links should show the same neutral unavailable message, such as "This invite is no longer available", and should not reveal whether a specific Team or email exists.
- Team Owners can remove pending Team Invites and resend invite emails. Resend exists for practical email loss/spam cases; it should not create a duplicate pending invite for the same Team and email.
- Accepted Team Invites should land the invitee in **My Work View**, optionally filtered or highlighted to the invited Team. My Work aggregates actionable Backlog Items across all Teams the user belongs to.
- First-time Team Workers should see lightweight in-place guidance explaining that they can claim Backlog Items and use JobDone's microphone/capture flow to record thoughts or evidence with minimal friction. This guidance should not block claiming or capture.
- Every User keeps a personal Timeline and can create their own Teams. Team membership adds collaborative Backlogs and Approval flows; it does not replace personal capture.
- V1 Teams use a simple capability split: the **Team Owner** manages settings, invites, and approval/backlog configuration; **Team Workers** claim work and submit evidence through My Work.
- A Team Owner is a logged-in User who created or owns a Team. Team Invite creation needs this logged-in owner identity so JobDone can associate the invite with a sender/owner address.
- MVP Team Invite creation should use simple anti-spam guardrails: require login, rate-limit invite creation per owner, and cap pending invites per Team. Bulk company import is deferred until real demand appears.
- V1 Backlog management is Team Owner-led. Team Workers do not directly create Backlog Items in the first Team Invite/Work slice; they can talk to the Team Owner outside the app or through a later request/conversation path. This keeps Backlog Items intentional: if work is too small to need thought, it may not belong in the Backlog.
- My Work may offer a Team filter when the aggregate Backlog becomes noisy, but the default worker experience should show everything actionable across Teams without requiring a Team switch first.
- The setup surface is now **Team Edit**: it summarizes Teams the user owns and Teams they belong to, lets the user select an owned Team to edit, and lets them create a new Team. Team names are not globally unique in V1; users may create same-named Teams and disambiguate through ownership/membership context.
- Approval Requests are always created when claimed work is submitted. Team settings decide whether they require manual review or use **Auto-Approval**.
- Completing a claimed Backlog Item always requires at least one evidence Entry, such as short text, voice, photo, or an explicitly linked existing Entry. This preserves JobDone's core value: the Team gets an operational record, not just a checked-off task.
- **Auto-Approval** is Team-level in V1. Per-member auto-approval is deferred because it starts to become a permission matrix.
- Owner self-review is a separate Team setting: by default, when a Team Owner submits their own claimed work, JobDone creates the Approval Request and auto-closes it as approved so the evidence trail exists without self-approval friction. Teams that want stricter process can require Team Owners to manually approve their own work.
- Team creation should offer simple **Team Templates**. The default should be **High Trust Team** so friction does not accidentally creep into ordinary collaboration.
- Example Team Templates: High Trust Team can use Auto-Approval and no Points; Low Trust Team can use manual Approval; Family Team can use manual Approval and Points.
- Team Templates are setup shortcuts, not durable Team types. After creation, Teams morph by changing real settings; for example a Family Team can become a High Trust Team over time by turning off manual review or Points.
- Evidence helper copy should explain value rather than compliance, such as "Capture what happened now so your future self can find it later."

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
- "Retrieval Property Testing", "RecallPropertyTest", and "V0 Recall property harness" were used interchangeably — resolved: the discipline is **Recall Property Testing**; the current deterministic slice is the **V0 Recall Property Harness**.
