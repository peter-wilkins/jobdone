#!/usr/bin/env node

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { fromUrl } from 'geotiff';
import proj4 from 'proj4';

const BNG = 'EPSG:27700';
const WGS84 = 'EPSG:4326';
const EA_WCS_URL = 'https://environment.data.gov.uk/geoservices/datasets/13787b9a-26a4-4775-8523-806d13af58fc/wcs';
const EA_ELEVATION_COVERAGE_ID = '13787b9a-26a4-4775-8523-806d13af58fc__Lidar_Composite_Elevation_DTM_1m';
const WALES_DTM_COG_URL = 'https://dmwproductionblob.blob.core.windows.net/cogs/lidar/wales_dtm_16bit_cog.tif';

proj4.defs(BNG, '+proj=tmerc +lat_0=49 +lon_0=-2 +k=0.9996012717 +x_0=400000 +y_0=-100000 +ellps=airy +towgs84=446.448,-125.157,542.06,0.1502,0.247,0.8421,-20.4894 +units=m +no_defs');

function argValue(name, fallback = null) {
  const index = process.argv.indexOf(name);
  if (index === -1) return fallback;
  return process.argv[index + 1] || fallback;
}

function hasArg(name) {
  return process.argv.includes(name);
}

function finiteNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

export function latLonBoundsFromDataset(dataset) {
  const points = [];
  for (const area of dataset?.areas || []) {
    for (const ring of area.rings || []) {
      for (const point of ring || []) {
        const latitude = finiteNumber(point?.[0]);
        const longitude = finiteNumber(point?.[1]);
        if (latitude !== null && longitude !== null) points.push([latitude, longitude]);
      }
    }
  }
  if (!points.length) {
    for (const candidate of dataset?.candidates || []) {
      const latitude = finiteNumber(candidate.latitude);
      const longitude = finiteNumber(candidate.longitude);
      if (latitude !== null && longitude !== null) points.push([latitude, longitude]);
    }
  }
  if (!points.length) throw new Error('No candidate or area points found for contour bounds.');
  return {
    south: Math.min(...points.map(point => point[0])),
    west: Math.min(...points.map(point => point[1])),
    north: Math.max(...points.map(point => point[0])),
    east: Math.max(...points.map(point => point[1])),
  };
}

export function bngBoundsFromLatLonBounds(bounds, bufferMetres = 0) {
  const corners = [
    [bounds.west, bounds.south],
    [bounds.west, bounds.north],
    [bounds.east, bounds.south],
    [bounds.east, bounds.north],
  ].map(point => proj4(WGS84, BNG, point));
  return {
    minE: Math.floor(Math.min(...corners.map(point => point[0])) - bufferMetres),
    maxE: Math.ceil(Math.max(...corners.map(point => point[0])) + bufferMetres),
    minN: Math.floor(Math.min(...corners.map(point => point[1])) - bufferMetres),
    maxN: Math.ceil(Math.max(...corners.map(point => point[1])) + bufferMetres),
  };
}

export function buildWcsUrl({ bounds, scaleFactor = 0.02 }) {
  const params = new URLSearchParams({
    service: 'WCS',
    version: '2.0.1',
    request: 'GetCoverage',
    coverageId: EA_ELEVATION_COVERAGE_ID,
    format: 'text/plain',
    scaleFactor: String(scaleFactor),
  });
  params.append('subset', `E(${bounds.minE},${bounds.maxE})`);
  params.append('subset', `N(${bounds.minN},${bounds.maxN})`);
  return `${EA_WCS_URL}?${params}`;
}

export function parseWcsTextGrid(text) {
  const boundsMatch = String(text).match(/Grid bounds:\s*GeneralBounds\[\(([-0-9.]+),\s*([-0-9.]+)\),\s*\(([-0-9.]+),\s*([-0-9.]+)\)\]/);
  if (!boundsMatch) throw new Error('WCS text grid did not include grid bounds.');
  const bounds = {
    minE: Number(boundsMatch[1]),
    minN: Number(boundsMatch[2]),
    maxE: Number(boundsMatch[3]),
    maxN: Number(boundsMatch[4]),
  };
  const rows = String(text)
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(line => /^-?\d+(?:\.\d+)?(?:\s+-?\d+(?:\.\d+)?)+$/.test(line))
    .map(line => line.split(/\s+/).map(Number));
  if (rows.length < 2 || rows[0].length < 2) throw new Error('WCS text grid did not include enough elevation rows.');
  const width = rows[0].length;
  if (!rows.every(row => row.length === width)) throw new Error('WCS text grid rows have inconsistent widths.');
  return { bounds, rows, width, height: rows.length };
}

function contourLevels(rows, intervalMetres) {
  let min = Infinity;
  let max = -Infinity;
  for (const row of rows) {
    for (const value of row) {
      if (!Number.isFinite(value)) continue;
      if (value < min) min = value;
      if (value > max) max = value;
    }
  }
  if (!Number.isFinite(min) || !Number.isFinite(max)) throw new Error('Contour grid did not include finite elevation values.');
  const first = Math.ceil(min / intervalMetres) * intervalMetres;
  const levels = [];
  for (let level = first; level <= max; level += intervalMetres) {
    levels.push(Number(level.toFixed(3)));
  }
  return levels;
}

function rowHasAnyFiniteValue(row) {
  return row.some(Number.isFinite);
}

function interpolatePoint(a, b, level) {
  const denominator = b.value - a.value;
  const ratio = denominator === 0 ? 0.5 : (level - a.value) / denominator;
  return {
    e: a.e + (b.e - a.e) * ratio,
    n: a.n + (b.n - a.n) * ratio,
  };
}

function cellIntersections(cell, level) {
  const [topLeft, topRight, bottomRight, bottomLeft] = cell;
  const edges = [
    [topLeft, topRight],
    [topRight, bottomRight],
    [bottomRight, bottomLeft],
    [bottomLeft, topLeft],
  ];
  return edges
    .filter(([a, b]) => (a.value < level && b.value >= level) || (b.value < level && a.value >= level))
    .map(([a, b]) => interpolatePoint(a, b, level));
}

function bngToGeoJsonCoordinate(point) {
  const [longitude, latitude] = proj4(BNG, WGS84, [point.e, point.n]);
  return [
    Number(longitude.toFixed(6)),
    Number(latitude.toFixed(6)),
  ];
}

function sameCoordinate(a, b) {
  return a[0] === b[0] && a[1] === b[1];
}

export function gridToContourFeatures(grid, { intervalMetres = 2 } = {}) {
  const { bounds, rows, width, height } = grid;
  const xStep = (bounds.maxE - bounds.minE) / (width - 1);
  const yStep = (bounds.maxN - bounds.minN) / (height - 1);
  const levels = contourLevels(rows, intervalMetres);
  const features = [];

  for (const level of levels) {
    for (let row = 0; row < height - 1; row += 1) {
      for (let col = 0; col < width - 1; col += 1) {
        const topN = bounds.maxN - row * yStep;
        const bottomN = bounds.maxN - (row + 1) * yStep;
        const leftE = bounds.minE + col * xStep;
        const rightE = bounds.minE + (col + 1) * xStep;
        const cell = [
          { e: leftE, n: topN, value: rows[row][col] },
          { e: rightE, n: topN, value: rows[row][col + 1] },
          { e: rightE, n: bottomN, value: rows[row + 1][col + 1] },
          { e: leftE, n: bottomN, value: rows[row + 1][col] },
        ];
        const intersections = cellIntersections(cell, level);
        for (let index = 0; index + 1 < intersections.length; index += 2) {
          const start = bngToGeoJsonCoordinate(intersections[index]);
          const end = bngToGeoJsonCoordinate(intersections[index + 1]);
          if (sameCoordinate(start, end)) continue;
          features.push({
            type: 'Feature',
            properties: {
              elevationMetres: level,
              intervalMetres,
            },
            geometry: {
              type: 'LineString',
              coordinates: [start, end],
            },
          });
        }
      }
    }
  }
  return features;
}

async function readJson(path) {
  return JSON.parse(await readFile(path, 'utf8'));
}

async function readWaterWalkSiteDataset(siteId) {
  const modulePath = resolve(process.cwd(), 'frontend/src/waterWalkSites.js');
  const { WATER_WALK_SITES } = await import(pathToFileURL(modulePath).href);
  const site = WATER_WALK_SITES.find(candidate => candidate.id === siteId);
  if (!site?.seedDataset) throw new Error(`Water Walk site ${siteId} does not declare a seedDataset.`);
  return site.seedDataset;
}

async function fetchText(url) {
  const response = await fetch(url, { headers: { 'user-agent': 'JobDone Water Walk contour generator' } });
  if (!response.ok) throw new Error(`WCS request failed: ${response.status} ${response.statusText}`);
  return response.text();
}

function cogWindowForBngBounds(image, bounds) {
  const [minX, , , maxY] = image.getBoundingBox();
  const [resolutionX, resolutionY] = image.getResolution();
  const pixelWidth = Math.abs(resolutionX);
  const pixelHeight = Math.abs(resolutionY);
  const left = Math.max(0, Math.floor((bounds.minE - minX) / pixelWidth));
  const right = Math.min(image.getWidth(), Math.ceil((bounds.maxE - minX) / pixelWidth));
  const top = Math.max(0, Math.floor((maxY - bounds.maxN) / pixelHeight));
  const bottom = Math.min(image.getHeight(), Math.ceil((maxY - bounds.minN) / pixelHeight));
  if (right - left < 2 || bottom - top < 2) throw new Error('COG window is too small for contours.');
  return { left, top, right, bottom };
}

async function readCogGrid({ cogUrl, bounds, sampleMetres = 1 }) {
  const tiff = await fromUrl(cogUrl);
  const image = await tiff.getImage();
  const window = cogWindowForBngBounds(image, bounds);
  const nativeWidth = window.right - window.left;
  const nativeHeight = window.bottom - window.top;
  const width = Math.max(2, Math.ceil(nativeWidth / sampleMetres));
  const height = Math.max(2, Math.ceil(nativeHeight / sampleMetres));
  const [values] = await image.readRasters({
    window: [window.left, window.top, window.right, window.bottom],
    width,
    height,
    interleave: false,
  });
  const noData = Number(image.getGDALNoData());
  const rows = [];
  for (let row = 0; row < height; row += 1) {
    const valuesRow = [];
    for (let col = 0; col < width; col += 1) {
      const value = Number(values[row * width + col]);
      valuesRow.push(Number.isFinite(value) && value !== noData ? value : NaN);
    }
    if (rowHasAnyFiniteValue(valuesRow)) rows.push(valuesRow);
  }
  if (rows.length < 2) throw new Error('COG window did not include enough valid elevation rows.');
  const [minX, , , maxY] = image.getBoundingBox();
  return {
    bounds: {
      minE: minX + window.left,
      maxE: minX + window.right,
      minN: maxY - window.bottom,
      maxN: maxY - window.top,
    },
    rows,
    width,
    height: rows.length,
    nativeWindow: {
      width: nativeWidth,
      height: nativeHeight,
    },
  };
}

async function main() {
  const source = argValue('--source', 'england-wcs');
  const siteId = argValue('--site-id', source === 'wales-cog' ? 'tumptonics' : 'dewlish');
  const defaultIntervalMetres = source === 'wales-cog' ? '1' : '2';
  const inputPath = resolve(process.cwd(), argValue('--input', 'local/water-walk/dewlish-with-bgs-water-wells.json'));
  const outputPath = resolve(process.cwd(), argValue('--output', `frontend/public/water-walk/${siteId}-contours-${argValue('--interval-metres', defaultIntervalMetres)}m.geojson`));
  const intervalMetres = Number(argValue('--interval-metres', defaultIntervalMetres));
  const scaleFactor = Number(argValue('--scale-factor', '0.02'));
  const bufferMetres = Number(argValue('--buffer-metres', '250'));
  const sampleMetres = Number(argValue('--sample-metres', '1'));
  const cogUrl = argValue('--cog-url', WALES_DTM_COG_URL);
  const dataset = source === 'wales-cog' ? await readWaterWalkSiteDataset(siteId) : await readJson(inputPath);
  const latLonBounds = latLonBoundsFromDataset(dataset);
  const bngBounds = bngBoundsFromLatLonBounds(latLonBounds, bufferMetres);
  const wcsUrl = buildWcsUrl({ bounds: bngBounds, scaleFactor });

  if (hasArg('--print-url')) {
    console.log(source === 'wales-cog' ? cogUrl : wcsUrl);
    return;
  }

  const grid = source === 'wales-cog'
    ? await readCogGrid({ cogUrl, bounds: bngBounds, sampleMetres })
    : parseWcsTextGrid(await fetchText(wcsUrl));
  const features = gridToContourFeatures(grid, { intervalMetres });
  const featureCollection = {
    type: 'FeatureCollection',
    properties: {
      schemaVersion: 'jobdone.waterWalkContours.v1',
      generatedAt: new Date().toISOString(),
      source: source === 'wales-cog' ? 'DataMapWales LiDAR DTM 1m COG' : 'Environment Agency LiDAR Composite DTM 1m WCS',
      sourceUrl: source === 'wales-cog' ? cogUrl : wcsUrl,
      siteId,
      intervalMetres,
      scaleFactor,
      sampleMetres,
      bounds: bngBounds,
      grid: {
        width: grid.width,
        height: grid.height,
        nativeWindow: grid.nativeWindow || null,
      },
    },
    features,
  };
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(featureCollection)}\n`);
  console.log(`Wrote ${features.length} contour segments to ${outputPath}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => {
    console.error(error);
    process.exit(1);
  });
}
