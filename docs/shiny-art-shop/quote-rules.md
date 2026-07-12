# Shiny Art Shop Quote Rules

Quote rules live in code, not in the database.

The git/deploy loop is fast enough for MVP, and code-hosted rules make pricing
changes reviewable and testable. A database/admin editor can come later if real
operations prove it is needed.

## Versioning

Rules are append-only once real customers use them.

Suggested layout:

```text
shared/shiny-project/
  quoteRules/
    shinyArtShop/
      v1.js
      v2.js
      v3.js
      index.js
    quoteEngine.js
```

Pre-launch, editing `v1` is acceptable. After launch:

- do not edit old rule files,
- add `v2`, `v3`, etc.,
- new Projects use the latest ruleset,
- existing Projects keep their quoted ruleset and snapshots.

## Quote Evaluation

The quote engine should be a pure function usable by frontend and backend:

```js
evaluateQuote(ruleset, input) -> {
  canAutoQuote,
  price,
  priceEstimate,
  depositDue,
  balanceDue,
  paymentPolicy,
  explanation,
  reviewReasons
}
```

Frontend use:

- calculate live quote for snappy UI,
- show explanation as the user changes size, quantity, and deadline.

Backend use:

- re-run the same rules before accepting payment/order,
- backend result is source of truth.

Security rule:

> Frontend quote is display only. Backend quote is authoritative.

## Explanation

Quotes should always explain themselves, even when human review is needed.

Auto-quote example:

```js
{
  canAutoQuote: true,
  price: 92,
  depositDue: 18.40,
  explanation: [
    "A4 embossed metal picture: GBP 80",
    "Copper effect: +GBP 10",
    "Rush: +25%"
  ]
}
```

Human-review example:

```js
{
  canAutoQuote: false,
  priceEstimate: 92,
  explanation: [
    "A4 embossed metal picture: GBP 80",
    "Copper effect: +GBP 10",
    "Rush: +25%",
    "Order notes need workshop review before checkout."
  ],
  reviewReasons: ["order_notes_present"]
}
```

## Review Triggers

Automatic pricing is disabled when scope may have changed.

Initial triggers:

- order notes present in Quote And Order form,
- custom size,
- unclear image,
- next-day or impossible deadline if unsupported,
- manual override,
- unsupported product/material/finish combination.

Style notes in the Design Preview form do not automatically disable automatic
quote. They guide preview generation.

Order notes in the Quote And Order form do disable automatic quote because they
may affect delivery, scope, or cost.

## Quote Snapshots

Quote snapshots are immutable.

Project stores many QuoteSnapshots. Current quote is derived:

- accepted quote if present,
- else latest offered quote,
- else latest draft estimate,
- ignore superseded snapshots.

Snapshot types:

- `automatic_estimate`
- `human_quote`
- `revision`
- `requote`

Snapshot contains:

- ruleset id/version,
- form input snapshot,
- result snapshot,
- explanation,
- review reasons,
- payment policy,
- actor: system/admin/customer where relevant,
- createdAt.

If customer changes size, quantity, deadline, or notes before payment, create a
new QuoteSnapshot. Terms acceptance applies only to the quote snapshot it was
accepted against.

## Payment Policy

Initial automated policy:

- under GBP 50: full upfront,
- GBP 50 or more: 20% deposit before work starts, balance before
  delivery/collection.

Human-reviewed Projects may override this.

Post-payment changes before production are a later feature:

- allowed only while status is `ready_for_workshop`,
- create a new QuoteSnapshot,
- calculate extra payment/refund/no change,
- human review if awkward,
- disabled after production starts.

MVP rule:

> After payment, customer may cancel before production starts but cannot
> self-edit paid order details. They contact the workshop for changes.

## Property Test Targets

Use property tests against the pure quote/status/command modules before UI.

Useful invariants:

- no production before required payment,
- no automatic cancellation after production starts,
- no payment without active quote,
- no ready/complete without workshop photo and customer approval,
- accepted terms are tied to active quote snapshot,
- quote snapshots are immutable,
- status derivation is deterministic,
- anonymous preview quota is enforced,
- unexpected contradictions produce `requires_human_attention`.
