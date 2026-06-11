# Product Actions use a generic envelope plus product schemas

JobDone will separate transport idempotency from domain commands.

## Decision

Keep `syncIntents` as transport/retry plumbing and add first-class Product
Action records for JobDone business commands.

```text
syncIntents  = idempotent request envelope
syncActions  = domain command attempted by JobDone
syncObjects  = resulting durable state
outboxEffects = async aftermath
opsEvents    = operator-visible failures
```

User-originated Product Actions use frontend-created UUIDv7 action IDs. Backend
or system-originated actions may use backend-created UUIDv7 IDs. This keeps
offline retries safe and avoids temp-ID rewrites.

## Why not use only syncIntents?

`syncIntents` answer "did this idempotent request already resolve?"

`syncActions` answer "what JobDone command was attempted, with what policy
result?"

Those vary independently. A future request may carry several declared actions,
or a retry may reference the same domain action through a new transport attempt.
Effects and debugging should point to the domain action, not only to HTTP retry
plumbing.

## Transaction rule

One Product Action request commits in one database transaction for MVP.

System failures roll back and return transport errors. Expected business
outcomes commit as action results:

- lost claim race -> committed action result `conflict`
- actor lacks action permission -> committed action result `rejected`
- accepted work -> committed action result `accepted`

HTTP status should report transport/request success, not business success. A
valid request with committed business results returns `200`, even when an
individual action is `rejected` or `conflict`.

Use HTTP errors for request/system failures:

- `400` invalid request shape
- `401` no auth
- `403` actor forbidden before action processing
- `409` request-level epoch/contract conflict
- `500`/`503` system failure

## Minimal action record

```text
syncActions
- id uuid primary key
- intentId uuid nullable references syncIntents(id)
- t bigint nullable references syncTransactions(t)
- actorUserId uuid not null
- actionType text not null
- ownerKind text not null
- ownerId uuid not null
- objectRefs jsonb not null default []
- stateJson jsonb not null default {}
- resultJson jsonb not null default {}
- status text not null check in accepted/rejected/conflict
- createdAt timestamptz not null default now()
```

`syncActions` do not carry private payload content. Private or later-encrypted
content belongs in `syncObjects.payloadJson` or future encrypted payload bytes.

Product Actions do not have to produce object changes. A rejected action can
commit only its result. A resend action might only enqueue an outbox effect.

## Zod composition

Generic sync code owns the reusable envelope helpers:

```js
export const actionEnvelopeSchema = z.object({
  id: uuidV7Schema,
  intentId: uuidV7Schema.optional(),
  actionType: z.string(),
  actorUserId: z.uuid(),
  owner: z.object({
    ownerKind: z.enum(['user', 'team']),
    ownerId: z.uuid(),
  }),
  objectRefs: z.array(z.object({
    collection: z.string(),
    id: z.uuid(),
    role: z.string().optional(),
  })).default([]),
  schemaVersion: z.number().int().positive().default(1),
  createdAt: z.iso.datetime(),
});

export function makeActionSchema(actionType, stateSchema) {
  return actionEnvelopeSchema.extend({
    actionType: z.literal(actionType),
    stateJson: stateSchema,
  });
}
```

JobDone policy code owns action meanings:

```js
const claimBacklogItemState = z.object({
  backlogItemId: z.uuid(),
  expectedStatus: z.literal('open'),
});

const decideApprovalRequestState = z.object({
  approvalRequestId: z.uuid(),
  decision: z.enum(['approved', 'needs_more_evidence']),
});

export const jobDoneProductActionSchema = z.discriminatedUnion('actionType', [
  makeActionSchema('claimBacklogItem', claimBacklogItemState),
  makeActionSchema('decideApprovalRequest', decideApprovalRequestState),
]);
```

Generic sync helpers must not import JobDone product schemas. JobDone policy
imports generic helpers and supplies product-specific `stateJson` schemas.

## Response shape

Product Action push responses should return:

```js
{
  intentId,
  toT,
  actionResults: [
    {
      actionId,
      actionType,
      status, // accepted | rejected | conflict
      reason,
      objectRefs,
      t,
    },
  ],
  objects,
  effects,
  opsEventIds,
}
```

The frontend can update local state from committed action results and changed
objects without inspecting backend logs. Effects are visible but not blocking.

## Non-goals

- Do not make Recall/Search a Product Action. Current Recall is local frontend
  behavior over materialized local data.
- Do not put private Entry text, Contact details, Location labels/addresses, or
  Photos into `stateJson`.
- Do not introduce a broad event-sourcing framework. Product Actions are a
  narrow policy/race/effect seam for JobDone.
