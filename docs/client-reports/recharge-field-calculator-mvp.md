# Recharge Field Calculator MVP

## Purpose

Help a practitioner estimate whether a proposed contour infiltration strip or
shelterbelt could increase water held or infiltrated on site.

The MVP is a screening and discussion tool. It does not claim measured spring
recharge or prove hydraulic connection to a spring.

## First Feature Type

Model only one feature type first:

- contour infiltration strip
- shelterbelt planted on or near contour

Other interventions, such as swales, ponds, leaky dams and check dams, are later
extensions.

## Core Output

The headline output is:

> Potential additional water held or infiltrated on site per year.

Any possible spring benefit is a separate confidence-adjusted interpretation and
depends on geology, groundwater flow and field evidence.

## Evidence Level

Each input and output carries an evidence level instead of a fake certainty
score:

- `assumed`: copied from literature, defaults or practitioner judgement
- `mapped`: derived from LiDAR, GIS or public datasets
- `observed`: seen during walkover and backed by notes or photos
- `measured`: field test entered with units and repeat count
- `reviewed`: checked by a hydrogeologist or relevant practitioner

The summary should say what kind of evidence the result mostly rests on, for
example:

> This result is mostly mapped and assumed. Add field measurements to strengthen
> it.

## Minimum Variables

- `annualRainfallMm`
- `featureAreaHa`
- `upslopeCatchmentHa`
- `baselineRunoffRate`
- `featureRunoffRate`
- `captureEfficiency`
- `baselineEvapotranspirationMm`
- `featureInterceptionRate`
- `featureTranspirationMm`
- `baselineInfiltrationMmPerHour`
- `candidateFeatureInfiltrationMmPerHour`
- `replicateCount`
- `antecedentCondition`
- `springConnectionConfidence`

## Field Test Direction

Use simple single-ring falling-head infiltration tests for the MVP. Record repeat
tests, calculate average and range, and treat the spread between tests as part of
the confidence score.

Default field protocol:

1. Push three bottomless rings into the soil close together in the same test
   zone.
2. Add a known depth or volume of water to each ring as a pre-wetting run.
3. Repeat in the same rings and use the second run as the measured infiltration
   value.
4. Record elapsed time for a measured water-level drop using a tape measure, or
   record the time for a known volume to infiltrate.
5. Average the three ring results and keep the range.
6. Repeat for each relevant zone.

Minimum useful field set:

- three rings in existing pasture
- three rings on or near the proposed feature line

Strong field set:

- three rings in existing pasture
- three rings on or near the proposed feature line
- three rings in a nearby young woodland or tree-line analogue

The app should support both ways of calculating infiltration:

- `dropMm / elapsedHours`
- `waterVolumeLitres / ringAreaSquareMetres / elapsedHours`

Ring diameter is only required when the user records a water volume instead of a
measured drop depth.

Prefer drop-depth measurement in the UX. A tape measure is part of the minimum
kit because it avoids eyeballing and is useful for other field measurements.

If the fastest ring in a zone is more than twice the slowest ring, flag the zone
as patchy and suggest another three-ring cluster or cautious interpretation.

Double-ring infiltrometer testing is the more formal route where design or
liability depends on the number.

## Lazy-First Data Entry

The app should ask the user for the minimum it cannot infer. Data should be
fetched or derived when possible:

- rainfall from public rainfall/climate datasets
- feature area from points drawn on the map
- upslope contributing area from points drawn on the map and LiDAR contours
- slope from LiDAR elevation data
- catchment shape from map drawing first, automated flow modelling later
- rainfall intensity from local design-storm datasets or conservative defaults

The user should be able to override every inferred value.

## Event Runoff Calculator

The annual litre estimate uses editable runoff assumptions. Field infiltration
tests improve an event-runoff estimate and help justify changing those
assumptions.

Minimum event inputs:

- `rainfallIntensityMmPerHour`
- `stormDurationHours`
- `measuredInfiltrationMmPerHour`
- `slopeClass`
- `groundCoverClass`

Output:

- rainfall excess depth
- runoff volume from upslope area
- intercepted volume if the feature captures a chosen percentage

## Core Citation Set

Keep the client document short, but include enough sources to show the method is
grounded:

- DataMapWales LiDAR DTM for contours, slope and topographic context
- NRCS Soil Health Infiltration guide for repeat ring infiltration testing
- FAO rainfall-runoff framing: runoff begins when rainfall intensity exceeds
  infiltration capacity
- Pontbren research for Welsh shelterbelt evidence: strategically placed tree
  belts in grazed pasture can substantially increase infiltration and reduce
  surface runoff
- Forest Research / UK woodland-water guidance for broader tree-water tradeoffs

Pontbren is a strong analogue for the story, but do not overclaim it as proof of
spring recharge. It supports tree/shelterbelt effects on infiltration and runoff;
groundwater connection still needs site-specific review.
