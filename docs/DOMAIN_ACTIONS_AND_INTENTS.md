# JobDone Domain Actions And Intents

This note is the current domain-language map for actions and intents. It
describes what exists now, and names the Hickey/decomplex direction without
pretending it has all shipped.

## Core User Actions

**Start Capture**

Creates local working state immediately. A Capture can begin with text, photos,
a platform share, or no text yet. It is local-only until Confirmation.

**Reject Capture**

Deletes an unconfirmed Capture. Rejection is only available before Confirmation;
confirmed Entries are immutable.

**Confirm Capture**

Commits the reviewed Capture into one or more durable outcomes, normally an
Entry plus optional Contact, Location, attachment, and context associations.
Confirmation is the user saying "this is true enough to enter my Timeline".

**Send Feedback Report**

Creates a maintainer-facing diagnostic/report artifact. Feedback is outside the
Timeline and should not become user work history.

## Team Actions

**Create Team**

Creates a Team owned by the signed-in user. A Team can be one person or many; it
is a work context, not necessarily an organisation.

**Invite Team Member**

Creates a pending Team Invite for an email address. A Team Invite exists before
a Team Member exists. Accepting the invite creates membership.

**Accept Team Invite**

Links the signed-in invited email to the Team and creates the Team Member. V1
uses Supabase auth links for frictionless identity.

**Create Backlog Item**

Adds intended work to a Team Backlog. A Backlog Item is not evidence that work
happened.

**Claim Backlog Item**

Moves an open Backlog Item into one Team Member's in-progress work. Claiming is
race-managed: one item should have one current claimant.

**Add Backlog Evidence**

Creates or links confirmed Entry evidence to a claimed Backlog Item. Evidence
does not by itself complete the item.

**Submit Claimed Work**

Sends claimed work for review. Current implementation creates an Approval
Request and moves the Backlog Item to `submitted` or `approved` depending on
Team settings.

**Decide Approval Request**

An Approver chooses `approved` or `needs_more_evidence`. Approval is separate
from Confirmation: Confirmation commits what the worker says happened; Approval
records whether the Team accepts it for an outcome.

## Sync Intents Today

The current Local Replica API accepts generic Sync Intents:

- `createObject`
- `updateObject`
- `deleteObject`

Each intent has a UUIDv7 idempotency key, owner scope, collection, object ID,
base object T for compare-and-set, payload hash, and payload JSON. The backend
checks owner access, applies the object mutation atomically, records the result,
and returns changed objects.

These generic actions are useful for dumb storage and offline retry, but they
are not enough to express product rules such as "only one user can claim this
Backlog Item" or "only an owner can approve submitted work".

Recall/Search is deliberately not listed as a backend action here. Current
Recall is frontend/local behavior over materialized local data. It may persist
recent Query text, but asking a Query does not need backend acceptance, race
management, or Product Action policy.

## Hickey Direction: Product Actions

The decomplex direction is to keep generic storage dumb, then add a JobDone
policy layer with named product actions:

- `createTeam`
- `inviteTeamMember`
- `acceptTeamInvite`
- `createBacklogItem`
- `claimBacklogItem`
- `addBacklogEvidence`
- `submitClaimedWork`
- `decideApprovalRequest`
- `createTimelineEntry`

These actions should be first-class, durable records. The action record is
separate from the object payload so rules, race handling, outbox effects, and
debugging can all point at "what was attempted" without reading private payload
content.

See `docs/adr/0011-product-actions-and-generic-sync-envelope.md` for the
`syncIntents`/`syncActions` split, UUIDv7 action ID rule, transaction semantics,
and Zod envelope pattern.

## Plaintext State JSON

`stateJson` is the backend-readable business metadata needed for policy. It is
not the private payload. JobDone owns its Zod schema.

Examples:

- Backlog status: `open`, `claimed`, `submitted`, `needs_more_evidence`,
  `approved`
- claimant identity for race handling
- approval status
- owner scope
- action kind

Private Entry text, Contact details, Location labels/addresses, and photos
belong in payloads that can later become encrypted.

## Effects

Post-commit work should be outbox effects, not hidden inside storage:

- send invite email
- send notification
- run optional AI cleanup/extraction
- write ops failure event

Effects run after the commit. They can retry independently. The frontend
response should say which effects were queued, not whether every async effect
already succeeded.

## Words To Avoid

- **Task** when we mean Backlog Item.
- **Save** when we mean Confirmation.
- **Approval** when we mean Confirmation.
- **Event** when we mean Entry.
- **Metadata** when we mean Context Clue, stateJson, or payload.
- **Mode** when we mean Team setting or Owner Scope.
