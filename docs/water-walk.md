# Water Walk

Water Walk is the first restoration evidence-capture page inside JobDone.

## Purpose

Peter can walk a farm, visit candidate water/restoration locations, and capture:

- notes
- photos
- GPS location
- timestamped local observations

The first version is deliberately simple. It uses ranked location pins, not noisy
field boundary polygons.

## Private Dewlish data

JobDone is a public repository, so private farm coordinates must not be committed
to the frontend bundle or source tree.

The page is visible in the app menu, but private Dewlish pins are loaded from:

```text
GET /api/water-walk/candidates
```

The backend only returns candidates to allowed accounts. The initial allowed
account is:

```text
poppetew@gmail.com
```

Candidate data comes from either:

- `JOBDONE_WATER_WALK_CANDIDATES_JSON`
- `JOBDONE_WATER_WALK_CANDIDATES_PATH`
- ignored local fallback: `local/water-walk/dewlish-candidates.json`

## MVP route planning

Route planning is nearest-next, not proper pathfinding.

That is enough for the first walk:

1. select interesting pins
2. capture current GPS
3. sort pins by nearest next
4. walk and gather evidence

Only add more routing complexity if field use proves this is not enough.

## Later

Later work can turn saved observations into:

- JobDone team work items
- evidence packs
- RegenOS grant/planning inputs
