# Recipe DSL Principles

Working principles for the Shiny Art Shop Recipe DSL and build pipeline.

These are inspired by the thi.ng ecosystem style: small composable packages,
data-first APIs, functional transforms, geometry utilities, parser combinators,
and reactive/live feedback loops. Do not treat this as a dependency decision.
Use libraries only when a concrete need appears.

## Principles

### Data First

DSL text is not the source of truth after parsing.

```text
DSL text -> AST -> Recipe Plan -> Build Graph -> Outputs
```

Each stage should be serializable, inspectable, cacheable, and testable.

### Small Operations

Prefer small composable operations over one large renderer.

Good:

- parse recipe text
- validate AST
- resolve material names
- build region plan
- render preview
- compute cut metrics
- run makeability checks

Bad:

- one function that parses text, mutates state, renders an image, writes files,
  and updates UI diagnostics.

### Pure Where Possible

Parsing, validation, plan resolution, scoring, and makeability checks should be
pure functions when practical.

Effects belong at the edges:

- reading source images
- reading material samples
- calling ImageMagick / Blender / CAD tools
- writing generated outputs
- serving files

### Pipelines Over Hidden State

Make the flow visible:

```text
Source Image
  -> Region Plan
  -> Material Plan
  -> Preview Render
  -> Cut Plan
  -> Makeability Diagnostics
```

For 3D:

```text
Form Asset
  -> Manufacturing Plan
  -> Slice Plan
  -> Export References
  -> Makeability Diagnostics
```

### Cache By Data

Cache generated outputs by stable data, not by UI state.

Good cache key inputs:

- recipe plan
- source asset identity
- material sample identity
- renderer version

Bad cache key inputs:

- current page state
- textarea cursor position
- rendered filename alone

### Diagnostics Are Outputs

Diagnostics are first-class build outputs, not console noise.

Examples:

- unknown command
- unknown material
- unsupported export
- slab plan is visual only, not CAM-ready
- licence attribution required
- cut path too small to manufacture

### UI Is A View Over The Plan

The visual editor and text DSL should edit the same Recipe Plan. Neither should
be a special path.

If the visual UI changes a material, it should produce the same AST/Recipe Plan
change as editing:

```text
region background
  material bright
```

### Delay Abstraction

Do not create a generic framework before two or three craft surfaces prove the
same shape.

Current useful surfaces:

- image-to-marquetry / embossed preview
- ammonite 3D asset / foam-slab diagnostics

Wait before extracting shared compiler/runtime code.

## Likely Future Libraries To Inspect

Inspect these only when the need is concrete:

- `@thi.ng/parse` or related parser tools if the hand parser grows.
- `@thi.ng/transducers` if image/path pipelines need reusable iterable
  composition.
- `@thi.ng/geom`-style ideas for geometry and path operations.
- `@thi.ng/rstream`-style ideas if the live editor needs a cleaner reactive
  dataflow.
