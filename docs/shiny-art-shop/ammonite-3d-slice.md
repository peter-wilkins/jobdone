# Ammonite 3D Recipe Slice

This is the first 3D extension for the Shiny Art Shop Recipe DSL.

The goal is not full procedural CAD yet. The goal is to prove that the Recipe
DSL can select an existing 3D asset, validate manufacturing intent, and produce
diagnostics and export references through the same Recipe Plan / Build Graph
shape as the 2D image recipes.

## Existing Assets

Generated workshop/CNC assets:

- `/home/peter/cnc-workshop-tools/local/ammonite-target/ammonite-sculpture-target-seed-7.stl`
- `/home/peter/cnc-workshop-tools/local/ammonite-target/ammonite-sculpture-target-seed-7.obj`
- `/home/peter/cnc-workshop-tools/local/ammonite-target/ammonite-sculpture-target-seed-7.blend`
- `/home/peter/cnc-workshop-tools/local/ammonite-target/manifest.json`
- `/home/peter/cnc-workshop-tools/local/ammonite-bold-compare/ammonite-bold-ribs-seed-12.stl`
- `/home/peter/cnc-workshop-tools/local/ammonite-bold-compare/manifest.json`

Reference scans with attribution:

- Natural History Museum / Thomas Flynn / CC BY 4.0
- Watt Institution / CC BY 4.0
- Imagineer / CC BY 4.0

Reference folder:

- `/home/peter/workflow-manager/local/ammonite-reference-models`

Before any commercial publication or client delivery, re-check the live licence
page and keep attribution beside derivative work.

## First DSL Shape

```text
form ammonite
  source sculpture-target
  size 650mm

pattern celtic-knot
  source generated-tile
  scale 1.0
  flow spiral
  relief raised 0.8mm

surface outer-ribs
  project pattern celtic-knot

manufacture foam-slab
  slab-thickness 50mm
  registration removable-ears

export stl
export slice-plan
```

## Meaning

- `form ammonite` selects a 3D Parametric Form family.
- `source sculpture-target` selects the existing generated model from
  `cnc-workshop-tools/local/ammonite-target`.
- `size 650mm` confirms the target scale from the manifest.
- `pattern celtic-knot` selects a 2D pattern intent.
- `source generated-tile` uses a generated placeholder pattern until a real
  Celtic tile asset exists.
- `flow spiral` says the 2D pattern should follow the ammonite's spiral
  structure rather than just project from camera space.
- `relief raised 0.8mm` asks for raised surface geometry later.
- `surface outer-ribs` selects the shell area receiving the pattern.
- `project pattern celtic-knot` connects the 2D pattern to the 3D surface.
- `manufacture foam-slab` selects a manufacturing strategy.
- `slab-thickness 50mm` matches the current visual slicing plan.
- `registration removable-ears` matches the current safe alignment plan.
- `export stl` exposes the model export.
- `export slice-plan` exposes the slab/slice manifest.

## Recipe Plan

The parsed Recipe Plan should resolve to data like:

```json
{
  "type": "threeDRecipe",
  "form": {
    "kind": "ammonite",
    "source": "sculpture-target",
    "asset": "ammonite-sculpture-target-seed-7",
    "sizeMm": 650
  },
  "patterns": [
    {
      "kind": "celtic-knot",
      "source": "generated-tile",
      "scale": 1,
      "flow": "spiral",
      "relief": { "kind": "raised", "heightMm": 0.8 }
    }
  ],
  "surfaces": [
    {
      "name": "outer-ribs",
      "projection": { "pattern": "celtic-knot" }
    }
  ],
  "manufacturing": {
    "process": "foam-slab",
    "slabThicknessMm": 50,
    "registration": "removable-ears"
  },
  "exports": ["stl", "slice-plan"]
}
```

## Diagnostics

The first implementation should be read-only and diagnostic-heavy.

Useful diagnostics:

- selected asset path
- selected preview image path
- STL path
- OBJ path
- Blend path
- slab count
- slab thickness
- stock bounds
- model bounds
- warning if registration holes sit outside the finished outline
- warning that generated slab meshes are planning geometry, not CAM
- attribution requirement when using museum/reference scans
- warning that Celtic pattern projection is intent-only until Blender/surface
  projection is implemented

## Why Existing Model First

Selecting an existing asset proves the DSL compiler/build-pipeline idea without
tangling it with procedural CAD generation.

The later procedural version can extend the same form:

```text
form ammonite
  source procedural
  seed 7
  turns 3.45
  growth 0.146
  rib-count 86
  size 650mm
```

That later slice can call Blender/CadQuery/Manifold build steps and cache the
outputs by Recipe Plan hash.

## Pattern Projection Direction

The exciting part is not changing the ammonite shape yet. Keep the shape fixed
and make the pattern variable.

The first useful progression:

1. Fixed ammonite form.
2. 2D Celtic pattern tile.
3. Named target surface: `outer-ribs`.
4. Projection intent: follow spiral flow.
5. Relief intent: raised `0.8mm`.
6. Diagnostics explain that real projection/export is not implemented yet.
7. Later build node uses Blender or another geometry tool to project the pattern
   onto the surface and produce a preview/export.

## Preview Technology Decision

Use Blender as the first truth-producing build backend for Celtic-on-ammonite
projection.

Do not make Three.js the first source of truth. Three.js is useful for fast
browser inspection, but it can make visual tricks look convincing without
creating manufacturable raised geometry. A browser shader, decal, or projected
texture is not enough for CNC/printing.

The source of truth should be:

```text
Recipe Plan
  -> Blender build script
  -> preview render
  -> .blend / .glb / .stl / diagnostics
```

Later, Three.js can consume the same Recipe Plan or exported GLB for a faster
interactive preview:

```text
Recipe Plan
  -> Three.js preview renderer

Recipe Plan
  -> Blender manufacturing renderer
```

Both renderers must consume the same Recipe Plan. The browser preview must not
invent geometry that the Blender/manufacturing path cannot reproduce.

## First Blender Build Slice

Input:

- fixed ammonite `.blend` or `.obj`
- generated Celtic pattern SVG
- Recipe Plan from the DSL

Output:

- rendered preview image
- updated `.blend`
- optional `.glb` for browser viewing
- diagnostics explaining what is real geometry and what is preview-only

Initial implementation can be crude:

1. Import/open existing ammonite model.
2. Add Celtic pattern as raised curves or shallow relief on a simple target
   surface approximation.
3. Render a still preview.
4. Save a generated `.blend`.
5. Report that manufacturing export is not proven until a real mesh/relief
   inspection pass exists.

The success criterion is not visual perfection. It is proving that the DSL
drives Blender from Recipe Plan data.
