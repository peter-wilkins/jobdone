# Water Walk

Water Walk is the first restoration evidence-capture page inside JobDone.

## Purpose

Peter can walk a farm, visit candidate water/restoration locations, and capture:

- notes
- photos
- GPS location
- timestamped local observations

The first version is deliberately simple. It uses ranked location pins plus a
small number of simplified context polygons, not noisy field boundary polygons.

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

Dataset data is validated with the shared Zod contract in:

```text
shared/contracts/waterWalkDataset.js
```

The backend loads the dataset in this order:

1. `jobdone.farm_datasets` row where `farm_id = dewlish` and `dataset_kind = water_walk`
2. `JOBDONE_WATER_WALK_CANDIDATES_JSON`
3. `JOBDONE_WATER_WALK_CANDIDATES_PATH`
4. ignored local fallback: `local/water-walk/dewlish-candidates.json`

Use this script to refresh the Supabase JSON blob from the ignored local file:

```bash
npm run water-walk:upsert
```

The JSON shape is:

- `projectId`
- `generatedAt`
- `sourceNotes`
- `candidates`
- `areas`
- `unmappedClayRichFields`

Clay-rich areas currently mean "SMP texture class hZCL - Heavy Silty Clay Loam".
They are not confirmed numeric clay percentages above 30%. The spreadsheet scan
found no numeric `Clay (%) > 30`; the highest numeric clay reading found was
25.35% in 8 Acres.

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
