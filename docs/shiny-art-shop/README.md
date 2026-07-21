# Shiny Art Shop

Shiny Art Shop is a product surface on the same underlying platform as
JobDone. It sells custom embossed metal pictures and layered art from customer
photos, logos, sketches, or ideas.

The first offer is deliberately small:

- A4 or smaller.
- Embossed metal pictures.
- Layered card artwork.
- "3D card picture" is acceptable customer-facing language for layered card
  artwork; it means relief/layers, not a freestanding sculpture.
- Custom from the customer's uploaded image.
- No public mention of AI. The customer buys a finished physical piece.

The workshop may use AI, rules, code, Cricut, router/CNC, and human judgement
behind the scenes. The customer-facing promise is a clear ordering experience
for bespoke physical artwork.

## Deployment Shape

The first implementation can live in the JobDone repo and ride on the same
frontend/backend deployment.

Hostnames can select product surface and branding:

- `jobdone.continuumkit.org` -> JobDone
- `shiny-art-shop.continuumkit.org` -> Shiny Art Shop

This keeps deploy speed and infrastructure simple while the shared platform is
still evolving. If the product later needs stricter isolation, it can split into
a separate app while keeping the shared domain/state-machine code.

## Positioning

Primary copy:

> Custom embossed metal pictures and layered art from your photo.

Supporting copy:

> Turn a favourite photo, logo, or moment into a custom embossed metal picture
> or layered artwork.

Secondary uses:

- Sports awards.
- Club prizes.
- Corporate gifts.
- Memorials and commemorations.
- Wall art and keepsakes.
- Boat, car, adventure, pet, and landmark pieces.

Avoid:

- Ordinary "trophy shop" language as the main category.
- "AI art" language.
- Claims about large-format workshop production before the workshop is ready.

## MVP Customer Flow

The MVP has two forms.

### 1. Design Preview

Purpose: decide the visual direction.

Inputs:

- Upload photo/logo/sketch.
- Artwork type: embossed metal picture or layered card artwork.
- Material/look.
- Finish/look.
- Style notes for preview.

Behaviour:

- Anonymous users get one successful generated preview per Project per generator
  version. A generator-version bump may deliberately allow one fresh preview for
  existing Projects when the preview model or prompt materially improves.
- Upload creates the Project immediately using a frontend-created UUIDv7.
- The customer sees their uploaded image immediately while upload finishes in
  the background.
- Design Direction is saved only when the customer requests a preview.
- The backend builds the image-generation prompt from controlled enum values.
  The frontend never sends or displays prompt text, and customer style notes are
  bounded non-authoritative data.
- The backend sends the customer source image plus tiny material reference
  swatches to the image generator. MVP swatches are approximate repo assets;
  replace them later with real photographed materials.
- The MVP default generator is GPT Image 2 through the OpenAI image edit API.
  `SHINY_IMAGE_PROVIDER` can switch the backend to another configured provider.
  Supported values: `openai`, `no-op-preview`, `local-emboss-filter`,
  `cloudflare-flux-2-dev`, `cloudflare-sd15-img2img`, and
  `google-imagemagick`.
- `no-op-preview` returns the uploaded source image as the preview. Use this
  when the next useful product slice is ordering/quoting rather than preview
  style quality.
- `local-emboss-filter` is deterministic image processing, not generative AI.
  It preserves source geometry exactly and is the preferred fast MVP preview
  path while generative providers are being evaluated.
- TODO: [GitHub issue #178](https://github.com/peter-wilkins/jobdone/issues/178)
  captures a later Google Cloud Run ImageMagick service spike. Local
  ImageMagick tests looked promising, but should be tuned against real handmade
  output once the workshop has produced reference pieces.
- The Google Cloud Run ImageMagick renderer is an MVP deterministic preview
  provider. It should be callable only with a shared bearer token from the
  JobDone/Shiny backend. The Cloud Run service may allow unauthenticated
  invocations at the Google layer for Vercel simplicity, but the renderer must
  reject requests without `Authorization: Bearer <token>`.
- The prompt treats the source image geometry, silhouette, subject identity, and
  proportions as hard constraints. If prompt-only editing still loses pet
  identity, continue the Flux/structure-lock provider spike.
- Generated previews are cached by Project, source image, Design Direction hash,
  and generator version. Reloads and retries for the same inputs should return
  the stored image rather than regenerating.
- If generation fails, keep the Project and source image, show "Oops, we had a
  problem. Try again in a few minutes.", and let the customer retry with the
  same editable Design Direction form.
- Preview is a guide, not a guarantee that the handmade piece will match exactly.

Customer-facing copy must not mention AI, models, prompts, or provider names.

MVP storage:

- Uploaded and generated preview image bytes live inside the Project payload in
  `syncObjects` as base64.
- TODO before scale: move image bytes to object storage and keep encrypted
  references in the Project payload.

### 2. Quote And Order

Purpose: price and submit the physical piece.

Locked from preview:

- Source image/design direction.
- Artwork type.
- Material/look.
- Finish/look.

Adjustable:

- Size: A5 or A4.
- Quantity.
- Deadline.
- Delivery/collection later.

Order notes:

- If the customer adds order notes, automatic pricing is disabled and the
  Project goes to human review.

Quote UI:

- The customer should see the price change in real time as size, quantity, and
  deadline change.
- If automatic pricing is unavailable, show the same quote explanation and a
  clear review message rather than a dead end.
- MVP quote form appears after design preview, creates a QuoteSnapshot, and
  stops before real payment/checkout.

## Payment Policy

Default automated policy:

- Full payment up front for every automatically quoted order.
- No production work starts until full payment is received.

Human-reviewed Projects can override payment policy:

- Full up front.
- Deposit or custom staged payment later if a human decides the project needs it.
- Invoice later.
- Waived.

No production work starts until required payment is received, unless a human
override is recorded.

## Workshop Queue

After the customer accepts terms and payment is recorded, the Project status is
derived as `ready_for_workshop`.

MVP workshop behaviour:

- `/api/shiny/workshop/queue` lists paid Projects that are ready for workshop
  work, Projects in production, and Projects waiting for customer approval.
- `#shiny-workshop` shows that queue in the frontend.
- The queue lets a workshop user mark production started once payment and terms
  are in place.
- Once production has started, the queue shows an upload control for the
  finished-piece photo.
- Each queue item links back to the Project page so workshop users can inspect
  the source image, preview, quote, and options.
- The queue is deliberately simple for the first slices: no auth gate, no
  assignment, and no stock reservation yet.

Next workshop slices:

- Customer approval before delivery/collection.
- Harden workshop access before real customers.

## Custom Order Terms

Before checkout, the customer must accept custom-order terms for the active
quote.

Working copy:

> I understand this is a custom-made item. I can cancel before production
> starts, but once production starts I cannot cancel for a change of mind. My
> statutory rights are not affected.

The exact checkbox copy and version must be stored against the Project/Quote.

Production start is a human command. The workshop user must confirm:

> This records that bespoke work has started. The customer can no longer cancel
> automatically for a change of mind.

Legal wording should be reviewed before launch.

## Approval Photo

Every Shiny Art Shop Project requires a real workshop photo before delivery or
collection.

Customer copy:

> Your preview is a guide. Each piece is handmade, so the finished artwork may
> differ. We will send a photo before delivery so you can approve it.

Adjustment policy:

- One reasonable adjustment is included after the approval photo.
- Major changes may need a new quote.
- The approval photo is for checking the finished handmade piece, not reopening
  the whole design.

## Later Side Quests

- Real AI preview generation.
- Generate Cricut-ready production instructions.
- Investigate Cricut Design Space import/API limits.
- Large-format router/CNC workshop production.
- Post-payment changes before production, with extra charge/refund calculation.
- More product templates.
