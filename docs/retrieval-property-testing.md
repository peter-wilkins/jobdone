# Retrieval Property Testing

Captured from: ChatGPT conversation `Local LLMs for Simple Tasks`

Captured on: 2026-05-31

Raw source cache:

```text
tmp/chatgpt-scrapes/20260531-local-llms/
```

This note adapts the useful ideas into JobDone language. The raw conversation is
not committed.

## Goal

JobDone Recall should behave like a boring, trustworthy query planner rather
than a magical chat answerer.

For a tradesperson, the dangerous failure is not "no answer". It is a confident
answer grounded in the wrong Contact, Location, Entry, or time window.

The test strategy should therefore prove retrieval grounding:

- the right Entries are returned
- the wrong Entries are excluded
- ambiguous Queries ask for clarification or show uncertainty
- expected answers are derived from source facts, not free-written labels

## Retrieval Router Shape

Use a three-stage planner:

```text
Query
  -> deterministic parser
  -> candidate retrieval plans
  -> retrieval engines
  -> merge/rerank
  -> context pack
  -> outcome log
```

The first version should start boring:

- Contact name or strong Contact clue -> Contact-scoped Entry lookup
- Location label/address clue -> Location-scoped Entry lookup
- "last time" / "recent" -> date ordering over matching Entries
- "invoice" / "paid" / "chase" -> status/tag-oriented lookup
- vague similarity words -> text/vector search
- repeated problem wording -> similar Entry search

Do not choose one engine too early. Many Queries should run several cheap plans:

- structured SQL/filter plan
- full-text plan
- vector/similarity plan
- recent Entries plan
- unresolved/status Tag plan

Then rerank with JobDone-specific penalties.

## Reranker Priorities

The reranker should heavily punish:

- wrong user/account
- wrong Contact
- wrong Location
- older Entry when Query says "last time"
- unconfirmed Capture masquerading as an Entry
- low-confidence Contact or Location match presented as certain

Useful reranker features:

- same confirmed Contact
- same confirmed Location
- recency
- matching Tags
- unresolved/follow-up status
- semantic similarity
- source reliability
- confidence of the prediction that selected the Contact or Location

Safety rules always beat model or ranking preferences.

## Synthetic Worlds

Before JobDone has enough real data, use small local/simple LLM agents to create
synthetic tradesperson worlds.

Do not generate isolated fake rows. Generate coherent lives:

- recurring Contacts
- recurring Locations
- repeated visit patterns
- voice-note style differences
- materials and follow-ups
- mistakes, misspellings, duplicates, and ambiguous names
- reopened issues months later
- photos or links without useful captions

Example personas:

- terse old-school sole trader
- organised commercial-maintenance plumber
- messy emergency-callout plumber with noisy dictation
- heat-pump/compliance specialist
- subcontractor with repeat builders and vague Contact records

Use local/simple LLMs for cheap mess generation, not for trusted labels.

## Golden Data Rule

Never trust a generated `expected_answer` string as the benchmark truth.

Prefer derivable expectations:

```json
{
  "query": "What did I do at Mrs Jones last time?",
  "expected_sources": ["entry_48192"],
  "expected_facts": [
    {
      "predicate": "tag_present",
      "value": "leaking isolation valve",
      "source": "entry_48192"
    }
  ],
  "excluded_sources": ["entry_47001"],
  "ambiguity": "none"
}
```

A deterministic validator can then check:

- source Entry exists
- Entry belongs to the right user
- Entry is confirmed
- Entry is linked to the expected Contact or Location
- Entry is the newest matching Entry when Query says "last time"
- no excluded Entry is newer or more relevant
- expected facts appear in structured fields or source text

The benchmark should test retrieval, not creative wording.

## Validator Pipeline

```text
generate synthetic world
generate candidate Queries
attach expected source IDs and structured facts
run deterministic oracle checks
run contradiction checks
run ambiguity checks
optionally run independent AI critique
promote only passing cases to golden set
```

If a generated case fails validation:

```text
save failing world
shrink to minimal facts
inspect the minimal failure
fix generator, oracle, or router
rerun
```

This is the property-testing loop: generated cases are useful only when the
oracle can prove their labels are boringly trustworthy.

## Useful Invariants

These invariants should become tests:

- every expected fact has a source Entry
- every source Entry belongs to the right user
- every source Entry is confirmed, not an unconfirmed Capture
- every Contact-specific Query has one clear Contact or is marked ambiguous
- every Location-specific Query has one clear Location or is marked ambiguous
- "last time" points to the newest matching confirmed Entry
- no newer matching Entry is excluded without a reason
- wrong-user Entries are never returned
- wrong-Contact Entries are strongly penalised
- missing Contact or Location does not block Recall, but lowers confidence
- ambiguous Queries do not pretend certainty

JobDone-specific invariants:

- Recall returns Entries only, not Captures, Contacts, Locations, or Share Packs
- immutable Entry snapshots remain the source of truth
- Query results are deterministic and cacheable for the same local data state
- local-first device state can replay cached Query results offline
- Share Pack generation must use only explicitly selected Recall results

## First Implementation Slice

1. Create a small synthetic-world fixture with Contacts, Locations, Tags,
   Entries, and Context Clues.
2. Add deterministic oracle functions for the first Recall classes:
   Contact history, Location history, latest matching Entry, unresolved/follow-up
   Entries, and similar-case search.
3. Generate a small set of Queries and expected source IDs.
4. Property-test the router against the fixture.
5. Log failures as minimal repro cases.

The local/simple LLM role is to generate varied Capture/Entry wording and messy
human Queries. The deterministic oracle owns truth.

## Open Design Questions

- Which Recall classes are MVP-critical enough for the first benchmark?
- Should vectors participate in the first property tests, or should the first
  suite test structured/full-text retrieval only?
- Where should generated fixture worlds live so they stay useful but never look
  like real customer data?
- Should the same synthetic worlds also test Tag Prediction and Share Pack
  boundaries?
