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

- Anonymous users get one successful generated preview per Project.
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

## Payment Policy

Default automated policy:

- If quote total is under GBP 50: full payment up front.
- If quote total is GBP 50 or more: 20% deposit before work starts, balance
  before delivery/collection.

Human-reviewed Projects can override payment policy:

- Full up front.
- 20% deposit.
- Custom deposit.
- Invoice later.
- Waived.

No production work starts until required payment is received, unless a human
override is recorded.

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
