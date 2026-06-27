#!/usr/bin/env node

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { z } from 'zod';
import { WATER_WALK_SITES, waterWalkSiteById } from '../frontend/src/waterWalkSites.js';
import { createWaterWalkDatasetParsers } from '../shared/contracts/waterWalkDataset.js';

const { parseWaterWalkDataset } = createWaterWalkDatasetParsers(z);
const DEFAULT_OVERPASS_URL = 'https://overpass-api.de/api/interpreter';
const FALLBACK_OVERPASS_URLS = [
  DEFAULT_OVERPASS_URL,
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass.openstreetmap.ru/api/interpreter',
];

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

function overpassBoxString(box) {
  return [box.south, box.west, box.north, box.east]
    .map(value => Number(value).toFixed(6))
    .join(',');
}

export function buildOverpassQuery(box, { includeWays = false } = {}) {
  const bbox = overpassBoxString(box);
  const wayQueries = includeWays
    ? `
  way["natural"="spring"](${bbox});
  relation["natural"="spring"](${bbox});
  way["man_made"="water_well"](${bbox});
  relation["man_made"="water_well"](${bbox});
  way["man_made"="spring_box"](${bbox});
  relation["man_made"="spring_box"](${bbox});
  way["historic"="well"](${bbox});
  relation["historic"="well"](${bbox});
  way["disused:man_made"="water_well"](${bbox});
  relation["disused:man_made"="water_well"](${bbox});
  way["abandoned:man_made"="water_well"](${bbox});
  relation["abandoned:man_made"="water_well"](${bbox});`
    : '';
  return `[out:json][timeout:25];
(
  node["natural"="spring"](${bbox});
  node["man_made"="water_well"](${bbox});
  node["man_made"="spring_box"](${bbox});
  node["historic"="well"](${bbox});
  node["disused:man_made"="water_well"](${bbox});
  node["abandoned:man_made"="water_well"](${bbox});${wayQueries}
);
out center tags;`;
}

function osmTitle(element) {
  const tags = element.tags || {};
  if (tags.name) return tags.name;
  if (tags.natural === 'spring') return 'OSM spring';
  if (tags.man_made === 'water_well') return 'OSM water well';
  return 'OSM historic water source';
}

function osmSourceKind(element) {
  const tags = element.tags || {};
  if (tags.natural === 'spring') return 'spring';
  if (tags.man_made === 'water_well') return 'water well';
  if (tags.man_made === 'spring_box') return 'spring box';
  if (tags.historic === 'well') return 'historic well';
  if (tags['disused:man_made'] === 'water_well') return 'disused water well';
  if (tags['abandoned:man_made'] === 'water_well') return 'abandoned water well';
  return 'water source';
}

function osmLocation(element) {
  const latitude = Number(element.lat ?? element.center?.lat);
  const longitude = Number(element.lon ?? element.center?.lon);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  return { latitude, longitude };
}

export function overpassElementsToCandidates(elements = []) {
  return elements
    .map(element => {
      const location = osmLocation(element);
      if (!location) return null;
      const title = osmTitle(element);
      const sourceKind = osmSourceKind(element);
      const osmId = `${element.type || 'node'}/${element.id}`;
      return {
        id: `osm-${String(element.type || 'node')}-${element.id}`,
        title: `${title} (${sourceKind})`,
        latitude: location.latitude,
        longitude: location.longitude,
        priority: 'low',
        theme: 'historic_water',
        score: 18,
        whyInteresting: [
          `OpenStreetMap has this as a ${sourceKind}.`,
          `OSM object ${osmId}.`,
        ],
        lookFor: [
          'wet ground or seepage',
          'stonework, pipe, cap, pump or trough',
          'rushes, moss, alder, willow or other wet-loving plants',
          'hollows, worn paths or old water infrastructure',
        ],
        evidencePrompt: `Check whether this mapped ${sourceKind} still has visible ground evidence. Take photos and notes; treat it as unverified until seen.`,
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.title.localeCompare(b.title) || a.id.localeCompare(b.id));
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

export function mergeHistoricCandidates(dataset, historicCandidates) {
  return {
    ...dataset,
    candidates: dedupeCandidates([
      ...(dataset.candidates || []),
      ...historicCandidates,
    ]),
    sourceNotes: [
      ...(dataset.sourceNotes || []),
      `OSM historic water import added ${historicCandidates.length} candidate pins.`,
    ],
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

async function fetchOverpass({
  query,
  overpassUrl = DEFAULT_OVERPASS_URL,
  fetchImpl = globalThis.fetch,
  timeoutMs = 15000,
}) {
  if (typeof fetchImpl !== 'function') throw new Error('This Node runtime has no fetch implementation.');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const response = await fetchImpl(overpassUrl, {
    method: 'POST',
    signal: controller.signal,
    headers: {
      'content-type': 'application/x-www-form-urlencoded;charset=UTF-8',
      'user-agent': 'JobDone Water Walk local importer',
    },
    body: new URLSearchParams({ data: query }),
  }).finally(() => clearTimeout(timer));
  if (!response.ok) throw new Error(`Overpass request failed: ${response.status} ${response.statusText}`);
  return response.json();
}

async function fetchOverpassWithFallbacks({ query, overpassUrl, fetchImpl = globalThis.fetch, timeoutMs }) {
  const urls = overpassUrl ? [overpassUrl] : FALLBACK_OVERPASS_URLS;
  const errors = [];
  for (const url of urls) {
    try {
      return await fetchOverpass({ query, overpassUrl: url, fetchImpl, timeoutMs });
    } catch (error) {
      errors.push(`${url}: ${error.message || error}`);
    }
  }
  throw new Error(`All Overpass endpoints failed. ${errors.join(' | ')}`);
}

async function main() {
  const siteId = argValue('--site', '85-dover-road');
  const site = waterWalkSiteById(siteId);
  if (!WATER_WALK_SITES.some(candidateSite => candidateSite.id === siteId)) {
    throw new Error(`Unknown site: ${siteId}`);
  }

  const inputPath = argValue('--input', site.id === 'dewlish' ? 'backend/local/water-walk/dewlish-candidates.json' : null);
  const outputPath = argValue('--output', `local/water-walk/${site.id}-osm-historic-water.json`);
  const mergeOutputPath = argValue('--merge-output', `local/water-walk/${site.id}-with-osm-historic-water.json`);
  const overpassUrl = argValue('--overpass-url', null);
  const timeoutMs = Number(argValue('--timeout-ms', 15000));
  const box = await resolveSearchBox(site, inputPath ? resolve(process.cwd(), inputPath) : null);
  const query = buildOverpassQuery(box, { includeWays: hasArg('--include-ways') });

  if (hasArg('--print-query')) {
    console.log(query);
    return;
  }

  const overpassPayload = hasArg('--fixture')
    ? await readJsonFile(resolve(process.cwd(), argValue('--fixture')))
    : await fetchOverpassWithFallbacks({ query, overpassUrl, timeoutMs });
  const candidates = overpassElementsToCandidates(overpassPayload?.elements || []);
  const outputDataset = {
    projectId: `${site.id}-osm-historic-water`,
    generatedAt: new Date().toISOString(),
    sourceNotes: [
      `OpenStreetMap Overpass historic water search for ${site.label}.`,
      `Search box ${overpassBoxString(box)}.`,
      `Source tags: natural=spring, man_made=water_well, man_made=spring_box, historic=well, disused/abandoned water_well.`,
    ],
    candidates,
    areas: [],
    unmappedClayRichFields: [],
  };
  const parsedOutput = parseWaterWalkDataset(outputDataset);
  if (!parsedOutput.success) throw new Error(`Generated invalid dataset: ${(parsedOutput.errors || [parsedOutput.error]).join('; ')}`);

  await mkdir(dirname(resolve(process.cwd(), outputPath)), { recursive: true });
  await writeFile(resolve(process.cwd(), outputPath), `${JSON.stringify(parsedOutput.data, null, 2)}\n`);
  console.log(`Wrote ${candidates.length} OSM historic water pins to ${outputPath}`);

  if (hasArg('--merge')) {
    if (!inputPath) throw new Error('--merge needs --input for the base Water Walk dataset.');
    const baseDataset = await readJsonFile(resolve(process.cwd(), inputPath));
    const merged = mergeHistoricCandidates(baseDataset, candidates);
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
