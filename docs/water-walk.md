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

Candidate pins have two separate classifications:

- `priority`: high, medium, low, or background; this says how strongly the
  location should be considered for a field walk.
- `theme`: water restoration, soil doctor, or syntropic agroforestry; this
  drives the map pin colour.

Clay-rich areas currently mean "SMP texture class hZCL - Heavy Silty Clay Loam".
They are not confirmed numeric clay percentages above 30%. The spreadsheet scan
found no numeric `Clay (%) > 30`; the highest numeric clay reading found was
25.35% in 8 Acres.

The current themed pins were scanned from:

- field KML zip centres
- SMP 2026 extracted PDF text
- Soil analysis export XLSX rows
- field names that indicate margins, cover strips, woodland edges, leazes, or
  lower/wetter ground

Soil Doctor pins highlight low organic matter, heavier clay, high pH,
compaction, or crop-risk clues for inspection. Syntropic agroforestry pins
highlight margins, cover strips, and woodland-edge reference points. They are
observation prompts, not planting recommendations.

## MVP route planning

Route planning is nearest-next, not proper pathfinding.

That is enough for the first walk:

1. select interesting pins
2. capture current GPS
3. sort pins by nearest next
4. walk and gather evidence

Only add more routing complexity if field use proves this is not enough.

## Map tiles

The Water Walk page uses Leaflet with OpenStreetMap raster tiles by default.
This gives pan, zoom, small pins, and polygon overlays without committing private
farm data into the frontend bundle.

Tile source configuration:

- default: `https://tile.openstreetmap.org/{z}/{x}/{y}.png`
- override URL: `VITE_WATER_WALK_TILE_URL`
- override attribution: `VITE_WATER_WALK_TILE_ATTRIBUTION`
- Ordnance Survey shortcut: set `VITE_OS_MAPS_API_KEY` and optionally
  `VITE_OS_MAPS_LAYER`, for example `Outdoor_3857`

OS Maps API through OS Data Hub is the likely better basemap for field detail.
It supports ZXY raster tiles and Leaflet, but needs an OS Data Hub project key.
Putting that key directly in a public frontend exposes it to the browser; for
production, prefer a small backend tile proxy or restricted key setup.

OS Data Hub projects can have both an API key and an API secret. The current
frontend-only tile path needs the API key, not the secret. Keep the API secret in
`backend/.env` as `OS_MAPS_API_SECRET` for a later server-side proxy/OAuth path.

Use the EPSG:3857 / Web Mercator ZXY layers with the current Leaflet map:

- `Outdoor_3857`
- `Road_3857`
- `Light_3857`

Do not use the `*_27700` ZXY endpoint in the current implementation. British
National Grid tiles need extra projection support, so they are a later job if
the 3857 OS layers are not detailed enough.

Do not add offline/preload tile downloads against `tile.openstreetmap.org`.
If offline field maps become necessary, use a tile provider that explicitly
allows offline use, OS Data Hub terms that cover it, or self-hosted tiles.

## Later

Later work can turn saved observations into:

- JobDone team work items
- evidence packs
- RegenOS grant/planning inputs
