# Shiny Art Shop Project Grinder

The Project Grinder is an internal implementation pattern for running a Shiny
Art Shop Project through preview, quote, payment, workshop, and approval steps.

It borrows the Coffee Grinder shape from CommandBook, but it is not a Shiny
domain term and does not need the full CommandBook runtime. Shiny Art Shop uses
Project, Image Recipe, Recipe Candidate, Quote, Payment, Workshop Photo,
Approval, and Invoice as product language.

## Why

Custom physical work does not run in one clean synchronous pass. A Project may
need image generation, human feedback, quote calculation, payment, workshop
upload, customer approval, retries, and exception handling.

The Project Grinder keeps those steps together as a resumable process instead
of scattering status glue across UI screens and API handlers.

## Split

```text
Domain facts/events
  -> pure Project status derivation
  -> Project Grinder selects next runnable step
  -> UI/API satisfies human requirements or records external events
```

Responsibilities:

- Domain facts/events are the durable truth.
- Derived Project status is a read model.
- Project Grinder state is orchestration memory.
- UI buttons and webhooks satisfy requirements or trigger commands.
- Side effects record receipts so retries are safe.

## Minimum State

For now, one Project JSON file can contain both Project facts and Project
Grinder state:

```json
{
  "projectId": "uuidv7",
  "createdAt": "iso-date",
  "projectFacts": {
    "sourceImages": [],
    "currentRecipe": {
      "recipeItems": []
    },
    "recipeSnapshots": [],
    "recipeCandidates": [],
    "quotes": [],
    "payments": [],
    "workshopPhotos": [],
    "approvals": []
  },
  "grinder": {
    "runId": "uuidv7",
    "goal": "completeProject",
    "queue": [],
    "humanRequirements": [],
    "completedSteps": [],
    "inProgressSteps": [],
    "receipts": [],
    "failures": []
  },
  "updatedAt": "iso-date"
}
```

Keep queue items as serializable data, not function closures, so a run can be
stored, inspected, resumed, retried, or moved between storage adapters.

Storage progression:

- local playground: JSON file on disk,
- web app MVP: Project payload JSON in the existing sync object,
- later: object storage or normalized Postgres rows only when size/querying
  proves JSON is not enough.

Domain facts remain the truth. Grinder state is orchestration memory. If
grinder state gets confused, rebuild it from facts where possible.

## Useful Steps

Early queue item types:

- `generateRecipeCandidate`
- `recordRecipeFeedback`
- `createRecipeSnapshot`
- `applyRecipeAdjustment`
- `calculateQuote`
- `requestPayment`
- `recordPayment`
- `startWorkshop`
- `uploadWorkshopPhoto`
- `requestCustomerApproval`
- `recordCustomerApproval`
- `markComplete`
- `raiseHumanAttention`

## Pauses

Human/customer pauses should be explicit:

- choose or adjust a Recipe Candidate,
- provide missing design information,
- accept quote,
- complete payment,
- upload workshop photo,
- approve finished piece,
- resolve human attention.

The UI should render the current requirement close to the action the person can
take.

## Receipts

Receipts are evidence that an important side effect happened, such as:

- preview generated and stored,
- quote snapshot created,
- payment checkout created,
- payment webhook received,
- workshop photo stored,
- customer approval recorded,
- email sent.

Receipts make retries boring: if a side effect already has a receipt, the
grinder verifies it rather than blindly repeating it.

## MVP Rule

Do not build a generic orchestration engine first.

Start with one explicit Project Grinder reducer for Shiny Art Shop. Extract a
reusable coffee-grinder library only after at least two product surfaces prove
they need the same mechanics.
