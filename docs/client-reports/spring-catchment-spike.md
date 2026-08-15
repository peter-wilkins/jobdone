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
   - Add the farm boundary or available-work area as an explicit constraint.
   - Fetch or read a LiDAR/DEM window around it.
   - Run DEM hydrology to produce an upslope contributing-area hypothesis.
   - Split the result into:
     - the wider topographic contributing area
     - the part inside land available for modification
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
- **Available-work area**: land where the practitioner or landowner can actually
  inspect, test or modify ground. Usually the farm boundary. This bounds the
  practical calculation even when the topographic catchment extends off site.
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

### Recommended Spike Path

Use a proven DEM hydrology engine server-side or in a local CLI, then show the
result in the phone UI.

1. Fetch a small DEM window around the spring.
2. Clip or intersect the analysis with the available-work area when provided.
3. Verify the raster orientation by sampling known nearby points and checking
   that reported elevation increases uphill.
4. Hydrologically condition the DEM by filling or breaching small sinks.
5. Calculate flow direction and flow accumulation.
6. Snap the spring/outlet point to a nearby high-flow cell if needed.
7. Delineate the contributing area.
8. Export both the full mapped catchment and the available on-farm portion:
   - catchment polygon GeoJSON
   - available catchment polygon GeoJSON
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

## Tight Feedback Loop

First spike should be a script, not a polished app:

```bash
npm run water-walk:spring-catchment -- \
  --lat 51.664158 \
  --lon -2.855463 \
  --radius-m 750 \
  --boundary local/water-walk/tumptonics/farm-boundary.geojson \
  --source wales-cog
```

Expected outputs:

```text
local/water-walk/tumptonics/catchment.geojson
local/water-walk/tumptonics/available-catchment.geojson
local/water-walk/tumptonics/spring-buffer-50m.geojson
local/water-walk/tumptonics/flow-accumulation.png
local/water-walk/tumptonics/catchment-preview.svg
```

Fast QA checks:

- sample elevations north/south/east/west of the spring and print them
- print catchment area in hectares
- print available-work catchment area in hectares when a boundary is supplied
- print outlet elevation and highest/lowest DEM elevation in the window
- draw flow arrows only after the sampled elevations confirm direction
- keep all generated outputs local until reviewed

## Phone MVP

The phone UI can stay simple:

1. Add or select spring.
2. Add or import farm boundary.
3. Tap **Estimate Catchment**.
4. See wider catchment, on-farm catchment, spring buffer and confidence label.
5. Tap **Field Test Plan**.
6. Record observations and infiltration tests.
7. Tap **Draft Report**.

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
