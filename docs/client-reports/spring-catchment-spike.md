# Spring Catchment Spike

## Purpose

Build a simple, phone-friendly workflow for answering:

> What land is likely to affect this spring, and where should we test before
> proposing recharge or regeneration work?

This is a screening workflow. It does not prove groundwater connection. It gives
the practitioner a useful first catchment hypothesis, then tightens that
hypothesis with field observations and infiltration tests.

## User Journey

1. **Research springs**
   - Search public and local sources for mapped springs, wells, spring boxes,
     wet flushes, old drains, field names and historic water clues.
   - Add candidate spring pins with source links and low/medium/high confidence.

2. **Find spring**
   - Walk to the spring or likely spring eye.
   - Capture GPS, photos, notes, flow direction, water clarity, turbidity after
     rain if known, pipework, animal access and vegetation clues.
   - Mark whether the spring is observed, measured or still inferred.

3. **Estimate the catchment**
   - Use the spring as the outlet/pour point.
   - Add the workable boundary as an explicit constraint.
   - Fetch or read a LiDAR/DEM window around it.
   - Run DEM hydrology to produce an upslope contributing-area hypothesis.
   - Split the result into:
     - the wider topographic contributing area
     - the part inside land available for modification or field testing
     - the practical/relevant area to inspect first
   - Display contours and hillshade only as map reading aids; do not derive the
     catchment from contour-line drawing.
   - Show a 50 m spring protection buffer as a no-intervention/check-carefully
     zone.

4. **Investigate on site**
   - Walk the mapped contributing area.
   - Record flow paths, compaction, poaching, drains, hollows, bedrock clues,
     wet/dry ground and existing vegetation.
   - Run three-ring infiltration clusters in pasture and likely recharge zones.
   - Optionally compare against a nearby young woodland or tree-line analogue.

5. **Report potential to improve/regenerate spring**
   - Summarise mapped catchment area, slopes and flow paths.
   - Summarise field evidence and infiltration results.
   - Estimate possible additional water held or infiltrated on site.
   - Keep spring benefit separate from site infiltration benefit unless reviewed
     by a hydrogeologist or supported by stronger field evidence.

## Domain Terms

- **Spring**: the observed or mapped point where groundwater emerges.
- **Outlet point**: the coordinate used by the hydrology tool to delineate a
  contributing area. For this spike, the spring is the outlet point.
- **Topographic catchment**: land that surface flow would reach from the DEM
  model. This is not automatically the same as the groundwater recharge area.
- **Workable boundary**: land where the practitioner or landowner can actually
  inspect, test or modify ground. Usually the farm boundary, but it can come
  from HMLR, RPW, manual drawing or a client-supplied file. This bounds the
  practical calculation even when the topographic catchment extends off site.
- **Relevant boundary**: the heuristic working area inside the workable boundary
  that is practical and plausibly relevant to the spring. It is a field-planning
  boundary, not a claim that groundwater definitely travels from every point in
  it to the spring.
- **Recharge hypothesis**: the current explanation of which land might affect
  the spring and why.
- **Spring protection buffer**: a conservative 50 m buffer around/above the
  spring where interventions need extra caution because direct short-circuiting,
  sediment movement, turbidity or contamination would be higher risk.
- **Evidence level**: `assumed`, `mapped`, `observed`, `measured`, `reviewed`.

## Why Not LUCI First?

LUCI, formerly Polyscape, is useful prior art: it is a GIS ecosystem-service
modelling framework that works with land cover, soils, topography, hydrology and
trade-offs. It is closer to a full landscape decision-support model than a fast
phone workflow.

For JobDone/Water Walk, steal these ideas from LUCI:

- model multiple benefits and trade-offs, not a single magic score
- make assumptions explicit
- combine map data with local knowledge
- use the tool to guide field investigation, not replace it

Do not copy LUCI's weight for the MVP. The first app should be spring-first,
interactive and small enough to use in a field.

## Tooling Options

## Boundary Acquisition

There does not appear to be a clean public API that returns "the farm boundary"
from a farm name or spring coordinate.

Practical options:

1. **HM Land Registry INSPIRE Index Polygons**
   - First source to try because it is public.
   - Public England/Wales freehold title polygons.
   - Useful for an indicative land-title boundary near the coordinate.
   - Not guaranteed to equal the working farm boundary.
   - Split by local authority and served/downloaded as GML, with WMS available
     for display.
   - Tumptonics appears to fall in the `Sir_Fynwy_-_Monmouthshire` local
     authority file.
   - Shell access to the old direct zip URL currently returns 403 here, and the
     newer download service appears to require browser/session handling. Treat
     this as "try first", not yet a reliable automated dependency.

2. **Rural Payments Wales shapefile export**
   - Best likely source for the real farm/field parcels.
   - Requires the landowner or authorised agent to log in to RPW Online.
   - RPW's interactive map can export shapefiles for the holding/land parcels.
   - Use this when the client can provide access or an export.

3. **Manual draw/import**
   - Fastest MVP path.
   - User draws the workable boundary on the phone or imports a GeoJSON/KML.
   - Later replace it with RPW or Land Registry-derived geometry when available.

The calculation should accept `--boundary` as optional. Without it, report the
full topographic catchment only and clearly say that the actionable on-farm area
is unknown.

## Service Architecture

Use the same pattern as the Shiny Art Shop image service:

- phone/browser UI stays simple JavaScript
- a local analysis service runs heavyweight open-source tools on this Linux
  laptop during the spike
- the UI calls the service over HTTP and receives GeoJSON/PNG/SVG outputs
- Tailscale can expose the laptop service to the phone in the field without a
  public deploy
- no deploy is needed for fast iteration while we are in the field/research loop
- later, wrap the same service in Docker and run it in the cloud if useful

The service contract should be boring:

```http
POST /spring-catchment
Content-Type: application/json
```

```json
{
  "spring": { "lat": 51.664158, "lon": -2.855463 },
  "radiusM": 750,
  "workableBoundaryGeoJson": null,
  "demSource": "wales-lidar-cog"
}
```

Response:

```json
{
  "catchmentGeoJson": {},
  "workableCatchmentGeoJson": null,
  "relevantBoundaryGeoJson": null,
  "outsideRelevantMaskGeoJson": null,
  "springBufferGeoJson": {},
  "previewSvgUrl": "/runs/abc123/catchment-preview.svg",
  "qa": {
    "catchmentAreaHa": 12.3,
    "workableCatchmentAreaHa": null,
    "relevantBoundaryAreaHa": null,
    "outletElevationM": 185.4,
    "demMinElevationM": 164.2,
    "demMaxElevationM": 238.9,
    "orientationCheck": "passed"
  }
}
```

Good first implementation:

- Node/Express or small Python/FastAPI wrapper
- GRASS GIS first, because `grass` is installed locally
- local output folder under `local/water-walk/<site>/`
- browser preview route for rapid visual checks

### Recommended Spike Path

Use a proven DEM hydrology engine server-side or in a local CLI, then show the
result in the phone UI.

1. Fetch a small DEM window around the spring.
2. Clip or intersect the analysis with the workable boundary when provided.
3. Verify the raster orientation by sampling known nearby points and checking
   that reported elevation increases uphill.
4. Hydrologically condition the DEM by filling or breaching small sinks.
5. Calculate flow direction and flow accumulation.
6. Snap the spring/outlet point to a nearby high-flow cell if needed.
7. Delineate the contributing area.
8. Build a relevant boundary as a heuristic overlay:
   - start with `topographicCatchment` intersected with `workableBoundary`
   - expand or reshape where geology, wet flushes, drains, spring lines or field
     observations make connection plausible
   - shrink where land is inaccessible, clearly disconnected or not practical to
     modify
9. Export the full mapped catchment, workable portion and relevant boundary:
   - catchment polygon GeoJSON
   - workable catchment polygon GeoJSON
   - relevant boundary GeoJSON
   - outside-relevant mask GeoJSON for display
   - flow accumulation raster/vector preview
   - hillshade/contours for visual QA
   - spring buffer polygon

Good candidates:

- **WhiteboxTools**: strong open-source terrain/hydrology CLI, good for an
  isolated service or local script.
- **GRASS GIS**: `r.watershed` plus `r.water.outlet` is mature and already
  installed locally.
- **QGIS processing**: useful wrapper around GRASS/SAGA for manual checks.
- **pysheds**: simple Python library for a focused prototype.

Use contours from a map/API only for display. Catchment maths should run from
the DEM because contours lose the raster flow information and can be easy to
misread or reverse.

### Data Sources

- DataMapWales LiDAR DTM COG for Welsh terrain.
- MapTiler Contours or similar contour tiles for display if we want pretty,
  non-reversed contours in the UI.
- OpenTopography for global DEM/hydrology ideas where local LiDAR is not
  available.
- BGS/NRW geology and groundwater vulnerability layers for interpreting whether
  the topographic catchment plausibly connects to the spring.
- Rural Payments Wales shapefile export for real farm/field boundaries when the
  landowner can provide it.
- HM Land Registry INSPIRE polygons for indicative freehold title boundaries
  where RPW data is not available.

## Tight Feedback Loop

First spike should be a script, not a polished app:

```bash
npm run water-walk:spring-catchment -- \
  --engine grass \
  --lat 51.664158 \
  --lon -2.855463 \
  --boundary local/water-walk/tumptonics/workable-boundary.geojson \
  --buffer-metres 250 \
  --resolution-metres 2 \
  --snap-radius-metres 40 \
  --output-dir local/water-walk/tumptonics/spring-catchment-2m
```

Current proof outputs:

```text
local/water-walk/tumptonics/spring-catchment-2m/catchment.geojson
local/water-walk/tumptonics/spring-catchment-2m/catchment-raw-bng.geojson
local/water-walk/tumptonics/spring-catchment-2m/catchment.tif
local/water-walk/tumptonics/spring-catchment-2m/dem-window.asc
local/water-walk/tumptonics/spring-catchment-2m/dem-window.geojson
local/water-walk/tumptonics/spring-catchment-2m/flow-accumulation.png
local/water-walk/tumptonics/spring-catchment-2m/flow-accumulation.tif
local/water-walk/tumptonics/spring-catchment-2m/qa.json
local/water-walk/tumptonics/spring-catchment-2m/snapped-outlet.json
```

Planned next outputs:

- `workable-catchment.geojson`
- `relevant-boundary.geojson`
- `outside-relevant-mask.geojson`
- `spring-caution-zone-50m.geojson`
- `catchment-preview.svg`

Fast QA checks:

- sample elevations north/south/east/west of the spring and print them
- print catchment area in hectares
- print workable catchment area in hectares when a boundary is supplied
- print relevant boundary area in hectares
- print outlet elevation and highest/lowest DEM elevation in the window
- draw flow arrows only after the sampled elevations confirm direction
- keep all generated outputs local until reviewed

First local GRASS proof on the guessed Tumptonics boundary:

- command output folder: `local/water-walk/tumptonics/spring-catchment-2m`
- DEM source: DataMapWales LiDAR DTM COG
- DEM window: workable boundary bounding box plus 250 m buffer
- resolution: 2 m
- spring snap radius: 40 m
- DEM min/max: 56 m / 220 m
- flow accumulation max: 85,438 cells
- snapped outlet: 39.1 m from supplied spring coordinate
- topographic catchment to snapped outlet: 5,638 cells, about 2.26 ha

This proves the tooling loop, not the field truth. The snapped outlet distance is
large enough that the spring position and local flow path should be checked in
the field or with a tighter hand-placed outlet before treating the catchment as
more than a mapped hypothesis.

## Phone MVP

The phone UI can stay simple:

1. Add or select spring.
2. Add or import workable boundary.
3. Tap **Estimate Catchment**.
4. See wider catchment, workable catchment, relevant boundary, spring buffer and
   confidence label.
5. Tap **Field Test Plan**.
6. Record observations and infiltration tests.
7. Tap **Draft Report**.

## Map Display Rule

Keep the relevant area visually clean. Do not tint the land the user is meant to
inspect.

Recommended map stack:

1. base map or hillshade
2. flow accumulation blue layer
3. workable boundary outline
4. outside-relevant mask, red or grey, muting everything outside the current
   focus area
5. spring point
6. spring caution zone
7. suggested field-test points

Use these display terms:

- `relevantBoundary`: clean active area
- `outsideRelevantMask`: muted excluded area outside the relevant boundary
- `workableBoundary`: outline only
- `springCautionZone`: separate ring or upslope caution patch

The blue layer should be labelled as mapped runoff concentration, not guaranteed
water flow.

The UI should make the confidence visible:

- `mapped only`: DEM and public datasets
- `field checked`: practitioner observations added
- `measured on site`: infiltration tests added
- `reviewed`: hydrogeologist/practitioner reviewed

## Research Notes

- Oxfam spring protection guidance recommends leaving at least 50 m above a
  spring without habitation or grazing, and using vegetation to reduce runoff
  and erosion.
- UK groundwater Source Protection Zone 1 uses the larger of a 50 m minimum
  radius or 50-day groundwater travel time around a domestic/food-production
  abstraction point.
- General spring protection guidance warns that direct surface-water flow into
  shallow groundwater can cause contamination, turbidity and rapid water-quality
  changes after rain.
- LUCI/Polyscape is strong prior art for landscape-scale trade-off modelling,
  but too heavy for the first spring-first phone workflow.

## Sources

- LUCI: https://luci.geo.vuw.ac.nz/
- Polyscape paper: https://seea.un.org/sites/default/files/12_3.pdf
- LUCI / ecosystem-services hydrology example:
  https://pmc.ncbi.nlm.nih.gov/articles/PMC7079118/
- Oxfam Spring Protection:
  https://www.oxfamwash.org/spring-protection/
- UK groundwater Source Protection Zones:
  https://www.gov.uk/guidance/groundwater-source-protection-zones-spzs
- DataMapWales LiDAR:
  https://datamap.gov.wales/maps/lidar-data-download/
- HM Land Registry INSPIRE polygons:
  https://use-land-property-data.service.gov.uk/datasets/inspire
- Rural Payments Wales shapefile export guide:
  https://help.thelandapp.com/en/articles/9822520-obtaining-field-parcel-data-from-rural-payments-wales
- GRASS `r.watershed`:
  https://grass.osgeo.org/grass-stable/manuals/r.watershed.html
- GRASS `r.water.outlet`:
  https://grass.osgeo.org/grass-stable/manuals/r.water.outlet.html
- WhiteboxTools watershed overview:
  https://geog-510.gishub.org/book/geospatial/whitebox.html
- pysheds:
  https://github.com/pysheds/pysheds
- OpenTopography hydrology tooling:
  https://opentopography.org/blog/taudem-processing-opentopography
- MapTiler contours:
  https://docs.maptiler.com/schema/contours/
