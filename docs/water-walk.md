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

## Map model

Keep these concepts separate:

- **Base maps**: the map Peter reads while walking, for example OSM, OS Outdoor,
  or later a LiDAR-derived raster/contour basemap.
- **Analysis layers**: optional overlays that explain landscape context, for
  example LiDAR contours, slope, flow accumulation, surface-water flood risk,
  soil class, habitat, or source-protection zones.
- **Candidate pins**: low-friction prompts for a field walk. They say "this
  might be worth checking", not "do work here".
- **Observation pins**: what Peter actually saw, photographed, or noted on the
  ground.

LiDAR should enter the app first as an analysis layer, not as pins. A contour or
hillshade layer can help Peter read the land directly. Later, if field use proves
it helps, a separate analysis step can derive candidate pins from LiDAR features
such as hollows, flow convergence, breaks of slope, possible old channels, or
potential bund/pond sites. Those derived pins should stay low-confidence because
shape is only one factor; access, soil, existing drains, ecology, land use, and
what is actually visible on the ground can matter more.

Candidate pins have two separate classifications:

- `priority`: high, medium, low, or background; this says how strongly the
  location should be considered for a field walk.
- `theme`: water restoration, soil doctor, syntropic agroforestry, or historic
  water; this
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

Historic water pins highlight possible old wells, springs, spring boxes, pumps,
or mapped water-source clues. They are "go and verify" prompts, not proof that
water still emerges there.

## Historic water-source imports

Searches for old springs and wells must be site-bounded by default:

- Dewlish: use the private site/farm geometry when available, then search within
  a modest buffer around it. If only a centre point is available, keep the radius
  small enough for a useful field walk.
- 85 Dover Road: use a tight local radius around the site default view or the
  first captured GPS anchor. Do not pull in all Weymouth/Dorset records.

Good first sources:

- British Geological Survey GeoIndex Water Wells: water wells, springs and water
  boreholes from the National Well Record Archive.
- OpenStreetMap Overpass: `natural=spring`, `man_made=water_well`,
  `man_made=spring_box`, and cautiously `amenity=drinking_water`.
- Dorset Historic Environment Record / Heritage Gateway: named historic wells,
  holy wells, village pumps, and waterworks where records are available.
- Historic Ordnance Survey maps via National Library of Scotland: useful for
  visual/manual review of labels such as `Spr` and `Well`, but treat extracted
  points as low-confidence until field checked.

Imported historic-water candidates should include:

- source name and URL
- source record id where available
- confidence: low, medium, high
- date or map epoch where available
- evidence prompt asking the walker to check for wet ground, seepage, stonework,
  pipes, vegetation change, hollow ways, or old water infrastructure

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

## LiDAR layer direction

The first LiDAR slice is an app-visible WMS overlay:

- Environment Agency LiDAR Composite DTM 1m hillshade WMS
- layer: `Lidar_Composite_Hillshade_DTM_1m`
- purpose: let Peter read terrain shape directly during a field walk

This keeps LiDAR as an analysis layer, not a candidate-pin generator.

The second LiDAR slice is a generated Dewlish contour layer:

- source: Environment Agency LiDAR Composite DTM 1m WCS
- generator: `npm run water-walk:contours`
- default interval: `2m`
- default scale factor: `0.02`, roughly a 50m inspection grid
- output: `frontend/public/water-walk/dewlish-contours-2m.geojson`
- toggle: `Contours 2m`
- bounds: mapped Dewlish areas first; wider candidate/search pins are fallback

Contours are generated rather than consumed from a fixed service so the interval
can change by job. Broad route planning may use 2m contours; a tighter pond,
check-dam, or dam-wall inspection could regenerate a smaller layer at 1m or
0.5m intervals.

The next LiDAR slice can produce a tighter bounded local layer:

1. Download only the Environment Agency LiDAR DTM tiles that intersect the site
   scope.
2. Generate a local contour or slope/flow raster/vector layer for inspection.
3. Serve or import that layer as an optional Water Walk analysis overlay.
4. Do not generate candidate pins until Peter has used the layer in the field and
   confirmed what visual cues are actually helpful.

## Surface-water flood risk layer

The first flood-risk slice is another optional WMS overlay:

- source: Environment Agency Risk of Flooding from Surface Water (RoFSW)
- dataset: `https://environment.data.gov.uk/dataset/b5aaa28d-6eb9-460e-8d6f-43caa71fbe0e`
- service: `https://environment.data.gov.uk/spatialdata/nafra2-risk-of-flooding-from-surface-water/wms?request=GetCapabilities&service=WMS&version=1.3.0`
- layer: `rofsw`
- toggle: `Surface water`

Use this as an indicative field-walk layer: it helps decide where water is
already modelled to lie or flow during rainfall. It should not be treated as
property-level flood truth or a design recommendation. The source service is
scale-gated around 1:50,000, so visibility may vary by zoom level.

Useful source:

- Environment Agency LiDAR Composite DTM, 1m where available:
  `https://environment.data.gov.uk/dataset/13787b9a-26a4-4775-8523-806d13af58fc`
- Environment Agency Risk of Flooding from Surface Water:
  `https://environment.data.gov.uk/dataset/b5aaa28d-6eb9-460e-8d6f-43caa71fbe0e`

## Later

Later work can turn saved observations into:

- JobDone team work items
- evidence packs
- RegenOS grant/planning inputs
- rough grant job budgets

## Grant job budgeting

Water Walk should eventually help a landowner decide whether a possible grant
job is economically worth exploring.

The first version should be rough and editable, not falsely precise.

For a selected candidate pin or observation, the app should be able to show:

- possible intervention, for example pond or leaky dam
- possible grant option
- likely grant income
- likely cash costs
- likely internal labour and machinery costs
- nearby materials that might reduce costs
- biggest unknowns
- confidence: low, medium, high
- landowner judgement: worth exploring, needs quote/adviser, or not worth it

Water Walk observations should capture budget clues while the user is already in
the field:

- machinery access
- ground wetness
- available gates/tracks
- rough dimensions
- likely labour difficulty
- nearby woody material, stone, soil, or other usable materials
- whether woodland or hedge work could supply dam material
- downstream risk or consent concerns

RegenOS owns the grant/intervention model. JobDone owns the user-facing capture
and editing flow.

Sites should eventually become Team-owned resources. A Team can own zero or
more Sites, and Team members should be able to see the Site data and add
observations according to their Team permissions. The current MVP keeps Sites as
frontend route/config choices while the field workflow is still being tested.
