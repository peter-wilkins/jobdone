# 3D Toolchain Research

The Recipe DSL should stay as glue and delegate 3D work to specialist tools.

## Shortlist

### CadQuery

Best first candidate for parametric 3D forms.

- Python library for parametric CAD.
- Exports STEP, AMF, 3MF, and STL.
- Good fit for build-graph execution on a server or local worker.
- Uses OpenCascade under the hood, so it is closer to real CAD than mesh-only
  graphics tooling.

Use for: parametric forms, accurate dimensions, STEP/3MF/STL exports.

### Blender Python

Best candidate for pattern projection, UVs, visual previews, and artistic mesh
operations.

- Strong Python API.
- Good at meshes, UV maps, materials, rendering, displacement, and texture
  projection.
- Can export STL/PLY and other formats.

Use for: wrapping Celtic/vector patterns onto curved forms, rendering previews,
surface maps, relief/displacement experiments.

### Manifold

Promising robust CSG/mesh boolean engine.

- Focused on manifold/watertight output.
- Has WASM support, so browser-side experiments are plausible.
- Better fit than ad hoc Three.js CSG when manufacturing robustness matters.

Use for: robust mesh booleans, browser-capable CSG experiments.

### Trimesh

Good Python mesh utility layer.

- Loads and exports many mesh/vector formats.
- Useful for measurement, repair-ish utilities, conversion, and glue scripts.

Use for: mesh inspection, export conversion, simple metrics, format bridging.

### OpenSCAD

Good reference point, weaker first choice for this DSL.

- Mature programmatic CAD with command-line export.
- Existing DSL and libraries.
- Less flexible than CadQuery for locator/face-driven modelling.

Use for: inspiration and maybe simple CSG exports.

### OpenCascade / OCCT

Powerful CAD kernel, not a first direct dependency.

- Full CAD/CAM/CAE geometry kernel.
- C++ SDK; CadQuery gives a friendlier route into it.

Use directly only if CadQuery becomes limiting.

## Recommendation

First 3D spike:

```text
Recipe DSL
  -> AST
  -> Recipe Plan
  -> build node: CadQuery creates ammonite-like base
  -> build node: Blender projects pattern / renders preview
  -> build node: export STL or 3MF
```

Do not build our own CAD kernel. The DSL should coordinate tools, cache their
outputs, and explain diagnostics.

## Source Notes

- CadQuery describes itself as scriptable parametric CAD and documents export
  paths for STEP, AMF, 3MF, STL, and related CAD formats:
  <https://cadquery.readthedocs.io/en/latest/intro.html> and
  <https://cadquery.readthedocs.io/en/latest/importexport.html>
- Blender exposes Python export operators and is the obvious visual/UV/projection
  tool when artistic mesh operations matter:
  <https://docs.blender.org/api/current/bpy.ops.export_scene.html>
- Manifold focuses on robust manifold mesh operations and has a browser-capable
  WASM build:
  <https://github.com/elalish/manifold> and
  <https://manifoldcad.org/docs/jsuser/>
- Trimesh is useful glue for loading, exporting, measuring, and converting mesh
  and vector formats:
  <https://trimesh.org/>
- OpenSCAD remains important prior art for text-defined CAD:
  <https://openscad.org/> and <https://github.com/openscad/openscad/>
- OpenCascade / OCCT is the serious CAD kernel underneath many tools, but is
  likely too low-level as our first direct dependency:
  <https://dev.opencascade.org/doc/overview/html/>
- ImplicitCAD is useful programmatic-CAD inspiration from the Haskell world:
  <https://implicitcad.org/docs/faq>
