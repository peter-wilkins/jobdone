# Shiny Art Shop Domain

Subject-neutral language for transforming customer images into manufacturable
custom work.

## Core Flow

```text
Project
  -> Current Recipe
      -> Recipe Item*
  -> Recipe Plan
      -> Preview Image
      -> Cut Plan
      -> Makeability Check
      -> Quote
  -> Recipe Candidate*
      -> Recipe Feedback
      -> Recipe Snapshot on positive feedback
      -> Recipe Adjustment -> Recipe Item*
```

## Project

**Project**:
The customer-facing end-to-end container for one custom piece of work.
_Avoid_: Artwork Project, Job, Order

Keep Project broad because the platform may expand beyond wall art into other
custom manufacturing areas. Use Project plus Invoice language rather than
Commission; Commission sounds too fancy and bespoke for the frictionless
upload/configure/quote/order flow.

## Source And Preview

**Source Image**:
The customer's original image before workshop interpretation.
_Avoid_: Original, Upload

**Preview Image**:
The generated or processed image shown to the customer as a guide for the
finished physical piece.
_Avoid_: Final Artwork, AI Image

**Source Essence**:
The identity-critical visual structure that must survive transformation.
_Avoid_: Similarity, Accuracy

**Essence Preservation**:
The Image Recipe goal of keeping Source Essence recognisable while changing
material, style, or manufacturing interpretation.
_Avoid_: Exact Copy, Identity Lock

Source Essence might be a pet's body shape, a landmark silhouette, logo
geometry, a distinctive pose, or the mood/composition of a whole landscape.

## Recipes

**Image Recipe**:
A reusable plan for transforming a Source Image into a manufacturable Preview
Image.
_Avoid_: Filter, AI Prompt, Renderer

**Recipe Item**:
One composable instruction inside an Image Recipe.
_Avoid_: Variant, Revision

**Current Recipe**:
The user's current selected collection of Recipe Items for the Project.
_Avoid_: Active Filter, Current Prompt

**Recipe Plan**:
The resolved, machine-readable plan produced from an Image Recipe before
rendering.
_Avoid_: Prompt, Pipeline, Render Config

**Region Recipe**:
An Image Recipe applied to one Composition Region.
_Avoid_: Regional Treatment

**Recipe Candidate**:
One generated Recipe Plan plus its Preview Image, shown for comparison.
_Avoid_: Variant, Winner

**Chosen Candidate**:
A Recipe Candidate selected by a human as worth keeping or using.
_Avoid_: Approved Preview

**Recipe Feedback**:
Human judgement attached to a Recipe Candidate, such as a rating, notes, or
"keeps essence".
_Avoid_: Approval, Like Only

**Recipe Snapshot**:
An immutable saved Image Recipe captured when the user gives positive feedback.
_Avoid_: Revision, Auto-Save

**Recipe Adjustment**:
A change requested after seeing a Recipe Candidate.
_Avoid_: Change Request, Patch

An Image Recipe is a collection of Recipe Items. A Recipe Item can say things
like "flatten Background Region", "preserve Source Essence", "quantize Whole
Image to four Material Samples", or "run Makeability Check for marquetry".

Positive Recipe Feedback creates a Recipe Snapshot capturing the Image Recipe at
that moment. Caveats in feedback, such as "good, but make sky quieter", may
become new Recipe Items in the Current Recipe, or remain Recipe Feedback notes
when they are too vague.

## Composition

**Composition Region**:
A meaningful visual area inside a Source Image that an Image Recipe can treat
differently.
_Avoid_: Pixel Group, Segment

**Background Region**:
The area visually behind the subject or Primary Interest.
_Avoid_: Sky

**Middle Ground Region**:
The spatial region between Foreground Region and Background Region.
_Avoid_: Centre Object

**Foreground Region**:
The lower/front area of the composition.
_Avoid_: Ground

**Subject Region**:
A semantic region containing a clear subject object or objects.
_Avoid_: Object In The Middle

**Primary Interest**:
The part of the Source Image the customer most wants the finished work to
preserve or emphasise.
_Avoid_: Subject Only, Focal Point Only

**Region Role**:
The job a Composition Region plays inside an Image Recipe.
_Avoid_: Label, Layer Type

Background, Middle Ground, and Foreground are spatial regions. Subject Region is
semantic: in a pet portrait it may be one animal, while in a landscape the whole
image or several regions may carry the Primary Interest.

Region Roles include Primary Interest, Supporting Detail, Quiet Area, Separation
Boundary, and Material Texture Carrier. Different Composition Regions may use
contrasting Visual Operations, Material Palettes, or Region Recipes when that
helps the Primary Interest stand out.

## Region Editing

**Region Mask**:
A user- or system-created mark showing which pixels belong to a Composition
Region.
_Avoid_: Segmentation as user-facing language

**Mark Region**:
Create or edit a Region Mask for a Composition Region.
_Avoid_: Label Pixels

**Refine Region**:
Improve an existing Region Mask boundary.
_Avoid_: Tune Segmentation

**Assign Region Role**:
Say what a marked region is for.
_Avoid_: Classify Pixels

**Lock Region**:
Prevent automation from changing a Region Mask or role.
_Avoid_: Freeze Layer

A Region Mask can come from manual drawing, a magic-wand/select-subject style
tool, or automated segmentation.

## Visual Operations

**Visual Operation**:
One subject-neutral step inside an Image Recipe.
_Avoid_: Effect, Filter

**Operation Target**:
The part of the Recipe Plan a Visual Operation applies to.
_Avoid_: Input Image Only

Core Visual Operation verbs:

- **Flatten**: reduce a Composition Region to one visual value/material.
- **Simplify**: reduce detail while keeping broad shape and readable structure.
- **Exaggerate**: increase contrast, edges, or scale of important visual
  structure.
- **Preserve**: keep identity-critical structure close to the Source Image.
- **Separate**: increase visual distinction between neighbouring regions or
  shapes.
- **Quantize**: reduce continuous colours/tones into a small material palette.

Operation Targets can include the Whole Image, a Composition Region, a Region
Mask, Source Essence, or a Material Palette. Avoid making "cartoonize"
canonical because it combines Simplify and Exaggerate.

The future **Image Recipe DSL** should describe intent rather than low-level
implementation steps. Users, workshop humans, and agents should be able to say
things such as "flatten background", "preserve subject silhouette", "exaggerate
edges", "set grain direction", and "quantize to four materials".
The system can compile that intent into segmentation, ImageMagick/G'MIC
operations, AI-assisted parameter tuning, palette mapping, or future cut-path
generation.

Makeability Checks should run automatically for every valid Recipe Plan so a
customer is warned before getting excited about something the workshop cannot
make.

The initial text syntax is documented in [`recipe-dsl.md`](./recipe-dsl.md).

The DSL can act as glue across existing craft tools rather than replacing them:
image-to-vector tracing, plotter art, lithophane/relief generation, embroidery
and weaving digitizers, SVG/DXF/CAD tools, slicers, and future CNC workflows.
For more complex work, the same language could orchestrate parametric geometry,
surface mapping, pattern projection, and fabrication export.

3D custom work should use the same glue-DSL idea. A Project may define a
parametric base shape, such as an ammonite shell, then project a 2D pattern,
such as Celtic knotwork, onto a named surface region before exporting STL, 3MF,
SVG texture maps, or toolpaths.

The DSL should compile through ordinary compiler/build-system stages:

```text
DSL text or guided UI
  -> AST
  -> name resolution and validation
  -> Recipe Plan intermediate representation
  -> Build Graph
  -> outputs, diagnostics, and receipts
```

The user-facing DSL should express intent commands such as "flatten background"
or "etch detail gentle". Machine constraints such as minimum piece width,
maximum material count, etch depth limits, and tested material limits belong in
the validation/search layer. Later constraint/search tools can propose Recipe
Items or parameters that satisfy those constraints.

## Materials And Craft

**Craft Process**:
The workshop method used to turn a Recipe Plan into a physical artwork.
_Avoid_: Product Type, Art Style, Medium as root term

**Craft Process Constraint**:
A Manufacturing Constraint that comes from a specific Craft Process.
_Avoid_: Style Rule

**Material Palette**:
The bounded set of real or simulated materials an Image Recipe may use.
_Avoid_: Colour Palette

**Material Sample**:
One available material option inside a Material Palette.
_Avoid_: Texture Only

Craft Processes include marquetry, embossed metal, layered card, routed relief,
and laser etching. A Recipe Plan normally has one primary Craft Process and one
or more Material Palettes. Region Recipes may use different Material Palettes.
Mixed-media work may later allow multiple Craft Processes, but that is not the
first design target.

One useful hybrid Craft Process is marquetry for large areas with gentle laser
etching for small detail. This lets the main Cut Plan stay makeable while fine
Source Essence details are added as low-depth surface marks rather than tiny
separate pieces.

A Material Sample can include colour, texture, grain direction, stock status,
and manufacturing notes.

## Manufacturing And Quote

**Manufacturing Constraint**:
A rule that limits what an Image Recipe may produce because the workshop has to
physically make it.
_Avoid_: Feasibility, Validation

**Makeability Check**:
A validation pass that reports whether a Preview Image or Image Recipe is
practical to manufacture.
_Avoid_: Computer Says No

**Cut Plan**:
The manufacturable vector plan derived from a Recipe Plan.
_Avoid_: SVG, Vector Art, G-code

**Cut Path**:
One vector path the machine may cut, score, engrave, or trace.
_Avoid_: Line

**Etch Detail**:
Fine visual detail added by low-depth laser scoring or engraving instead of
separate cut pieces.
_Avoid_: Tiny Marquetry Piece

**Cut Metric**:
A measured fact from a Cut Plan used for quoting or makeability.
_Avoid_: Machine Detail

**Nested Layout**:
An arrangement of Cut Paths on a physical material sheet.
_Avoid_: Nesting Screenshot

**Parametric Form**:
A generated 2D or 3D base shape controlled by named parameters.
_Avoid_: Mesh Blob

**Surface Region**:
A named part of a 3D form that can receive a pattern, texture, relief, or
toolpath.
_Avoid_: Face Index

**Pattern Projection**:
Mapping a 2D pattern onto a 2D or 3D target region while respecting its
geometry.
_Avoid_: Slap Texture On

**Fabrication Export**:
A downstream file produced from a Recipe Plan, such as SVG, DXF, STL, 3MF, or
G-code.
_Avoid_: Final File

**Complexity Price**:
The part of a quote derived from Cut Metrics and Makeability Checks.
_Avoid_: Difficulty Fee

**Detail Level**:
A customer-facing control that changes how much visual complexity the Image
Recipe tries to preserve.
_Avoid_: Quality, Resolution

Preview Image and Cut Plan are companion outputs from a Recipe Plan, not the
same thing. A pretty Preview Image can still produce a poor Cut Plan.

Cut Metrics include path length, node count, enclosed-piece count, etch density,
minimum part size, and travel distance. Complexity Price can include Path Length
Cost, Node Complexity Cost, Piece Count Cost, and Etch Density Cost.

Higher Detail Level generally means less Simplify, more Preserve and
Exaggerate, more regions, more Cut Paths, higher Cut Metrics, and a higher
Complexity Price.

Nested Layouts can later be shown to customers to make material efficiency and
workshop cleverness visible.

## Relationships

- A **Project** has one **Current Recipe** and may keep many **Recipe
  Snapshots**.
- An **Image Recipe** contains one or more **Recipe Items**.
- A **Region Recipe** is an **Image Recipe** scoped to one **Composition
  Region**.
- A **Recipe Plan** resolves an **Image Recipe** into concrete masks, selected
  materials, operation parameters, and makeability assumptions.
- A **Recipe Candidate** contains one **Recipe Plan** and one **Preview Image**.
- **Recipe Feedback** belongs to a **Recipe Candidate**.
- Positive **Recipe Feedback** creates a **Recipe Snapshot**.
- A **Recipe Adjustment** may create or change **Recipe Items** in the
  **Current Recipe**.
- A **Recipe Plan** can produce both a **Preview Image** and a **Cut Plan**.
- A **Cut Plan** produces **Cut Metrics**, which feed **Makeability Checks** and
  **Complexity Price**.

## Example Dialogue

> **Customer:** "I like this windmill one, but the background still has too much
> going on."
>
> **Workshop:** "We'll keep that as a Recipe Snapshot, then add a Recipe Item to
> flatten the Background Region harder while preserving the windmill as the
> Primary Interest."
>
> **Developer:** "So the next Recipe Candidate should use a Region Recipe for
> the Background Region and a stronger Separation Boundary around the windmill?"
>
> **Workshop:** "Yes. Also run a Makeability Check so the Cut Plan doesn't
> create too many tiny pieces."
