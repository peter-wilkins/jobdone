# Recall Property Testing

Captured from: ChatGPT conversation `Local LLMs for Simple Tasks`

Captured on: 2026-05-31

Raw source cache:

```text
tmp/chatgpt-scrapes/20260531-local-llms/
```

This note adapts the useful ideas into JobDone language. The raw conversation is
not committed.

## Terminology

**Recall Property Testing** is the discipline: proving Recall stays grounded in
the right Entry sources and excludes unsafe or irrelevant sources.

**V0 Recall Property Harness** is the current implementation slice: a small,
deterministic synthetic world plus oracle checks and minimal repro output. It is
not yet full generative testing with automatic shrinking.

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

This is the generative property-testing loop: generated cases are useful only
when the oracle can prove their labels are boringly trustworthy.

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

## Next Implementation Slice

The next Recall Property Testing target is real Recall path coverage with the
simplest trustworthy Recall mechanism, not larger fake worlds yet.

The V0 Recall Property Harness proves source-grounding rules against a
deterministic in-memory router approximation. The next slice should simplify
the production Recall mechanism so the real backend path is boring enough for
the property loop to explain clearly.

The current vector-first path should be parked out of the main Recall path while
the feedback loop is hardened. Prefer a simple SQL-first Recall path with
deterministic matching over confirmed Entry text and confirmed Contact,
Location, and Tag associations. Reintroduce vectors only when the property loop
shows exactly what improvement they add and what regressions they risk.

Do not scrap the current schema for Recall Property Testing. The existing Entry
plus confirmed Contact, Location, and Tag association tables are the right shape
for source-grounded tests. The simplification is in the Recall mechanism, not
the data model.

## Local Property Loop

Run the local-Supabase Recall property loop explicitly:

```bash
npm --prefix backend run test:recall:integration
```

The loop reads or creates `backend/.recall-property-golden.json`. That file is
ignored by git and is the only golden artifact format. Do not silently overwrite
it; regenerate deliberately with:

```bash
REGENERATE_RECALL_GOLDEN=1 npm --prefix backend run test:recall:integration
```

On failure, the loop writes a shrunk JSON repro to
`tmp/recall-property-failures/latest.json` and includes the Query, oracle
expectation, actual results, match reasons, and shrunk world. GitHub Actions can
surface the same summary through `GITHUB_STEP_SUMMARY`, but CI adoption remains
optional until local Supabase startup is boring.

For SQL-first Recall V1, searchable truth is:

- `entries.summary`
- confirmed `contacts.display_name`
- confirmed `locations.display_name`, `locations.place_text`, and
  `locations.address_text`
- confirmed `tags.label`

`entries.transcript` stays stored as source/debug material but is not Recall
matching truth in V1. This keeps property failures tied to confirmed Entry memory
and confirmed structure rather than raw dictation noise.

Use plain deterministic token/phrase matching in SQL before Postgres full-text
search. The first property loop should explain failures in simple terms such as
"Contact exact phrase matched", "Location exact phrase matched", "Tag exact
phrase matched", "summary token overlap matched", and "recency boosted latest".
Full-text stemming/ranking can come later if the simple loop shows a clear gap.

The current focus is the property-test feedback loop itself, not UI. The loop
should make Recall regressions easy to generate, shrink, understand, fix, and
re-run before any user-facing explanation work is considered.

Local Supabase is the target execution environment for this slice, but it should
be an explicit integration-test dependency rather than part of the default
backend unit suite:

- `npm --prefix backend test` stays fast and does not require Supabase
- `npm --prefix backend run test:recall:integration` may require local Supabase
- the integration test seeds generated Recall fixture data into local Supabase
- it drives `recallEntries()` through the production SQL-first Recall path and
  ranking
- it shrinks failures to the smallest useful world/query/reason repro
- the first integration slice uses deterministic fake embeddings and seeded
  query vectors only if legacy/vector behaviour is under explicit comparison;
  the main SQL-first path does not call live Voyage
- CI should add this only once local Supabase startup is boring and reliable

Vector reranking comes later, after the local-Supabase property loop can explain
simple SQL-first Recall failures clearly.

For the first generated local-Supabase slice, vary world shape and wording while
keeping the oracle simple.

Allowed variation:

- number of Entries per user
- repeat Contacts and Locations
- ambiguous same-first-name Contacts
- wrong-user Entries
- unconfirmed Captures
- summary wording
- Tags such as follow-up, invoice, service, and similar workflow labels
- recency and Entry order

Out of scope for this slice:

- schema shape
- auth/RLS behaviour
- transcript matching
- vector embeddings
- Share Packs
- UI/API response format

When a generated property fails, print the shrunk repro to stdout and the
GitHub Actions summary, and write a local ignored artifact under
`tmp/recall-property-failures/`.

The default artifact is:

```text
tmp/recall-property-failures/latest.json
```

It should include the seed, shrunk world, Query, oracle expectation, actual
result, and match reasons. Do not commit these artifacts by default. If a failure
reveals an important regression, promote a hand-trimmed version into a checked-in
fixture or test.

Start with a small local golden generated set for day-to-day development. The
golden set gives continuity: agents and humans keep seeing the same example
worlds, Queries, and failure modes while Recall is changing.

Regenerate the golden set deliberately when the schema, oracle, or generator
contract changes enough that the old examples no longer describe the system.
Every generated case should retain its seed and generator version so failures
can be reproduced or invalidated intentionally.

Do not commit bulky generated worlds by default. Keep the generator contract,
schema version, and maybe one tiny smoke fixture in git; keep the golden set
itself under an ignored local path because it is generated data and can make the
repo sluggish if it grows.

Use JSON as the only golden artifact format. The same JSON should drive local
Supabase seeding and shrinking, so there is no separate Postgres dump/cache
format to keep in sync.

The default local golden path is:

```text
tmp/recall-property/golden-v1.json
```

Default execution should be stable and small. Deeper random runs should be
opt-in, for example with `RECALL_PROP_SEED=123` to replay one seed and
`RECALL_PROP_RUNS=500` to explore more cases locally.

## Open Design Questions

- Should the same synthetic worlds also test Tag Prediction and Share Pack
  boundaries?
- When local Supabase startup is boring, should the generated property loop run
  in CI by default or remain a release-gate/manual check?
