# Shiny Art Shop Recipe DSL

The Recipe DSL is a small external text syntax for expressing Image Recipe
intent. It is not the canonical data model; parsed AST/JSON is canonical.

## Text Syntax Rules

1. One instruction per line.

```text
flatten background
preserve essence
```

2. Indentation means "inside this block".

```text
region background
  role quiet-area
  flatten
```

3. No braces, commas, or semicolons.

```text
palette walnut oak maple
```

4. First word is the command.

```text
craft marquetry
palette walnut oak maple
region background
flatten
material maple
```

5. Commands can have simple arguments after them.

```text
quantize 4 materials
etch-detail gentle
min-piece-width 3mm
```

6. Blocks start with a command line.

```text
region primary-interest
  preserve essence
  separate boundaries
```

7. Names are lowercase kebab-case.

```text
primary-interest
quiet-area
etch-detail
```

8. Comments start with `#`.

```text
# keep the windmill readable
preserve essence
```

9. Blank lines are ignored.

10. Canonical meaning is the parsed AST, not the text formatting.

## Example

```text
craft marquetry
palette walnut cedar oak ash bright
detail-level balanced

region background
  role quiet-area
  flatten
  material bright
  grain diagonal-right

region primary-interest
  role primary-interest
  preserve essence
  separate boundaries
  etch-detail gentle

region foreground
  role supporting-detail
  simplify
```

## Parser Shape

The first parser should be intentionally small:

- tokenize lines,
- count indentation,
- parse command plus arguments,
- build nested blocks,
- validate commands against a schema,
- lower to Recipe Items.

Do not execute DSL text as code.

## First Command Vocabulary

Top-level commands:

```text
craft <craft-process>
palette <material-sample>...
detail-level <simple|balanced|detailed|intricate>
region <composition-region>
```

Region block commands:

```text
role <region-role>
flatten
simplify
preserve essence
separate boundaries
etch-detail <gentle|medium|strong>
material <material-sample>
grain <horizontal|vertical|diagonal-left|diagonal-right>
quantize <number> materials
```

Makeability checks run automatically for every valid Recipe Plan. They are not
normally written in the user-facing DSL.

Allowed starter values:

```text
craft-process:
  marquetry
  embossed-metal
  layered-card
  routed-relief
  laser-etching

composition-region:
  background
  middle-ground
  foreground
  subject
  primary-interest

region-role:
  quiet-area
  primary-interest
  supporting-detail
  separation-boundary
  material-texture-carrier

material-sample:
  ash
  bright
  brown-stain
  cedar
  contours
  contrast
  dark
  grainy
  green
  grey
  grey-yellow
  knot
  knotty
  liney
  oak
  orange
  rich
  sand-dunes
  walnut
  copper
  brass
  aluminium
  white-card
  black-card
```

## AST Shape

The parser should produce data like this:

```json
{
  "type": "imageRecipe",
  "craftProcess": "marquetry",
  "materialPalette": ["walnut", "oak", "maple", "birch"],
  "detailLevel": "balanced",
  "recipeItems": [
    {
      "type": "regionRecipe",
      "target": "background",
      "recipeItems": [
        { "type": "assignRegionRole", "role": "quiet-area" },
        { "type": "flatten" },
        { "type": "selectMaterial", "material": "bright" },
        { "type": "setGrain", "angle": "diagonal-right" }
      ]
    },
    {
      "type": "regionRecipe",
      "target": "primary-interest",
      "recipeItems": [
        { "type": "assignRegionRole", "role": "primary-interest" },
        { "type": "preserve", "target": "essence" },
        { "type": "separate", "target": "boundaries" },
        { "type": "etchDetail", "strength": "gentle" }
      ]
    }
  ]
}
```

Validation should reject unknown commands, unknown values, wrong indentation,
and commands used in the wrong scope.

## Future 3D Glue Syntax

The same DSL should later describe parametric 3D forms and pattern projection.
Keep this as design sketch until a real prototype needs it.

```text
form ammonite
  turns 3.5
  growth-rate 1.2
  profile circle 10mm

pattern celtic-knot standard

surface outer-ribs
  project pattern celtic-knot
  fit stretch-to-fit
  relief raised 0.8mm

export stl
export svg surface-map
```

Intent:

- `form` creates a Parametric Form.
- `pattern` names or imports a 2D pattern.
- `surface` names a Surface Region.
- `project pattern` creates Pattern Projection.
- `relief` changes surface height for printing/carving.
- `export` creates a Fabrication Export.

The DSL should remain glue. It can call CAD, mesh, UV/surface-mapping, slicer,
or CAM tools rather than reimplementing them.
