#!/usr/bin/env node

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { z } from 'zod';
import { WATER_WALK_SITES, waterWalkSiteById } from '../frontend/src/waterWalkSites.js';
import { createWaterWalkDatasetParsers } from '../shared/contracts/waterWalkDataset.js';

const { parseWaterWalkDataset } = createWaterWalkDatasetParsers(z);
const BGS_WATER_WELLS_QUERY_URL = 'https://map.bgs.ac.uk/arcgis/rest/services/GeoIndex_Onshore/boreholes/MapServer/2/query';

function argValue(name, fallback = null) {
  const index = process.argv.indexOf(name);
  if (index === -1) return fallback;
  return process.argv[index + 1] || fallback;
}

function hasArg(name) {
  return process.argv.includes(name);
}

function degreesForMetres(latitude, metres) {
  const latDegrees = metres / 111_320;
  const lonDegrees = metres / (111_320 * Math.max(Math.cos(latitude * Math.PI / 180), 0.2));
  return { latDegrees, lonDegrees };
}

function pointBox(latitude, longitude, radiusMetres) {
  const { latDegrees, lonDegrees } = degreesForMetres(latitude, radiusMetres);
  return {
    south: latitude - latDegrees,
    west: longitude - lonDegrees,
    north: latitude + latDegrees,
    east: longitude + lonDegrees,
  };
}

function expandBox(box, radiusMetres) {
  const centreLatitude = (box.south + box.north) / 2;
  const { latDegrees, lonDegrees } = degreesForMetres(centreLatitude, radiusMetres);
  return {
    south: box.south - latDegrees,
    west: box.west - lonDegrees,
    north: box.north + latDegrees,
    east: box.east + lonDegrees,
  };
}

function boxFromDataset(dataset) {
  const points = [];
  for (const candidate of dataset?.candidates || []) {
    const latitude = Number(candidate.latitude);
    const longitude = Number(candidate.longitude);
    if (Number.isFinite(latitude) && Number.isFinite(longitude)) points.push([latitude, longitude]);
  }
  for (const area of dataset?.areas || []) {
    for (const ring of area.rings || []) {
      for (const point of ring || []) {
        const latitude = Number(point?.[0]);
        const longitude = Number(point?.[1]);
        if (Number.isFinite(latitude) && Number.isFinite(longitude)) points.push([latitude, longitude]);
      }
    }
  }
  if (!points.length) return null;
  return {
    south: Math.min(...points.map(point => point[0])),
    west: Math.min(...points.map(point => point[1])),
    north: Math.max(...points.map(point => point[0])),
    east: Math.max(...points.map(point => point[1])),
  };
}

function boxToArcGisGeometry(box) {
  return {
    xmin: box.west,
    ymin: box.south,
    xmax: box.east,
    ymax: box.north,
    spatialReference: { wkid: 4326 },
  };
}

async function readJsonFile(path, fallback = null) {
  try {
    return JSON.parse(await readFile(path, 'utf8'));
  } catch {
    return fallback;
  }
}

async function resolveSearchBox(site, inputPath) {
  const radiusMetres = Number(site.searchScope?.radiusMetres || 1000);
  const dataset = inputPath ? await readJsonFile(inputPath) : null;
  const datasetBox = dataset ? boxFromDataset(dataset) : null;
  if (datasetBox && site.searchScope?.mode === 'site_buffer') return expandBox(datasetBox, radiusMetres);
  const view = site.defaultView;
  if (!view) throw new Error(`Site ${site.id} has no defaultView`);
  return pointBox(Number(view.latitude), Number(view.longitude), radiusMetres);
}

export function bgsFeatureToCandidate(feature = {}) {
  const properties = feature.properties || {};
  const coordinates = feature.geometry?.coordinates || [];
  const longitude = Number(coordinates[0]);
  const latitude = Number(coordinates[1]);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;

  const reference = String(properties.REFERENCE || properties.REGNO || properties.OBJECTID || '').trim();
  const location = String(properties.LOCATION || '').trim();
  const depth = Number(properties.DEPTH || 0);
  const year = String(properties.YEAR || '').trim();
  const aquifer = String(properties.AQUIFER || '').trim();
  const sourceId = String(properties.GDI_HYDRO_ID || properties.OBJECTID || reference).trim();
  const titleParts = [location || 'BGS water well', reference].filter(Boolean);
  const details = [
    reference ? `Reference ${reference}` : '',
    properties.REGNO ? `register ${properties.REGNO}` : '',
    depth > 0 ? `depth ${depth} m` : '',
    year ? `year ${year}` : '',
    aquifer ? `aquifer ${aquifer}` : '',
  ].filter(Boolean);

  return {
    id: `bgs-water-well-${sourceId}`.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, ''),
    title: titleParts.join(' - '),
    latitude,
    longitude,
    priority: 'low',
    theme: 'historic_water',
    score: depth > 0 ? 24 : 18,
    whyInteresting: [
      'BGS GeoIndex Water Wells records this point in the National Well Record Archive.',
      ...details.slice(0, 3),
    ],
    lookFor: [
      'well cap, cover, pipe, pump, trough or stonework',
      'wet ground, seepage or drainage infrastructure',
      'vegetation change such as rushes, moss, willow or alder',
      'check whether the point is public land, private land or only context',
    ],
    evidencePrompt: 'Check whether this BGS water-well record has visible ground evidence. Take photos and notes; treat it as a mapped archive clue until field verified.',
  };
}

export function bgsFeatureCollectionToCandidates(featureCollection = {}) {
  return (featureCollection.features || [])
    .map(bgsFeatureToCandidate)
    .filter(Boolean)
    .sort((a, b) => (b.score - a.score) || a.title.localeCompare(b.title));
}

function dedupeCandidates(candidates = []) {
  const seen = new Set();
  return candidates.filter(candidate => {
    const key = candidate.id || `${candidate.title}:${candidate.latitude}:${candidate.longitude}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function mergeBgsCandidates(dataset, bgsCandidates) {
  return {
    ...dataset,
    candidates: dedupeCandidates([
      ...(dataset.candidates || []),
      ...bgsCandidates,
    ]),
    sourceNotes: [
      ...(dataset.sourceNotes || []),
      `BGS GeoIndex Water Wells import added ${bgsCandidates.length} candidate pins.`,
    ],
  };
}

async function fetchBgsWaterWells({ box, endpoint = BGS_WATER_WELLS_QUERY_URL, fetchImpl = globalThis.fetch }) {
  if (typeof fetchImpl !== 'function') throw new Error('This Node runtime has no fetch implementation.');
  const params = new URLSearchParams({
    f: 'geojson',
    where: '1=1',
    outFields: '*',
    returnGeometry: 'true',
    geometry: JSON.stringify(boxToArcGisGeometry(box)),
    geometryType: 'esriGeometryEnvelope',
    spatialRel: 'esriSpatialRelIntersects',
    inSR: '4326',
    outSR: '4326',
  });
  const response = await fetchImpl(`${endpoint}?${params}`);
  if (!response.ok) throw new Error(`BGS request failed: ${response.status} ${response.statusText}`);
  return response.json();
}

async function main() {
  const siteId = argValue('--site', '85-dover-road');
  const site = waterWalkSiteById(siteId);
  if (!WATER_WALK_SITES.some(candidateSite => candidateSite.id === siteId)) throw new Error(`Unknown site: ${siteId}`);

  const inputPath = argValue('--input', site.id === 'dewlish' ? 'backend/local/water-walk/dewlish-candidates.json' : null);
  const outputPath = argValue('--output', `local/water-walk/${site.id}-bgs-water-wells.json`);
  const mergeOutputPath = argValue('--merge-output', `local/water-walk/${site.id}-with-bgs-water-wells.json`);
  const box = await resolveSearchBox(site, inputPath ? resolve(process.cwd(), inputPath) : null);

  if (hasArg('--print-query')) {
    console.log(JSON.stringify({ endpoint: BGS_WATER_WELLS_QUERY_URL, geometry: boxToArcGisGeometry(box) }, null, 2));
    return;
  }

  const featureCollection = hasArg('--fixture')
    ? await readJsonFile(resolve(process.cwd(), argValue('--fixture')))
    : await fetchBgsWaterWells({ box });
  const candidates = bgsFeatureCollectionToCandidates(featureCollection);
  const outputDataset = {
    projectId: `${site.id}-bgs-water-wells`,
    generatedAt: new Date().toISOString(),
    sourceNotes: [
      `BGS GeoIndex Water Wells bounded search for ${site.label}.`,
      `Source: ${BGS_WATER_WELLS_QUERY_URL}`,
    ],
    candidates,
    areas: [],
    unmappedClayRichFields: [],
  };
  const parsedOutput = parseWaterWalkDataset(outputDataset);
  if (!parsedOutput.success) throw new Error(`Generated invalid dataset: ${(parsedOutput.errors || [parsedOutput.error]).join('; ')}`);

  await mkdir(dirname(resolve(process.cwd(), outputPath)), { recursive: true });
  await writeFile(resolve(process.cwd(), outputPath), `${JSON.stringify(parsedOutput.data, null, 2)}\n`);
  console.log(`Wrote ${candidates.length} BGS water-well pins to ${outputPath}`);

  if (hasArg('--merge')) {
    if (!inputPath) throw new Error('--merge needs --input for the base Water Walk dataset.');
    const baseDataset = await readJsonFile(resolve(process.cwd(), inputPath));
    const merged = mergeBgsCandidates(baseDataset, candidates);
    const parsedMerged = parseWaterWalkDataset(merged);
    if (!parsedMerged.success) throw new Error(`Merged invalid dataset: ${(parsedMerged.errors || [parsedMerged.error]).join('; ')}`);
    await mkdir(dirname(resolve(process.cwd(), mergeOutputPath)), { recursive: true });
    await writeFile(resolve(process.cwd(), mergeOutputPath), `${JSON.stringify(parsedMerged.data, null, 2)}\n`);
    console.log(`Wrote merged dataset to ${mergeOutputPath}`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => {
    console.error(error.message || error);
    process.exitCode = 1;
  });
}
