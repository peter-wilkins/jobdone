#!/usr/bin/env node

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import proj4 from 'proj4';

const BNG = 'EPSG:27700';
const WGS84 = 'EPSG:4326';
const EA_WCS_URL = 'https://environment.data.gov.uk/geoservices/datasets/13787b9a-26a4-4775-8523-806d13af58fc/wcs';
const EA_ELEVATION_COVERAGE_ID = '13787b9a-26a4-4775-8523-806d13af58fc__Lidar_Composite_Elevation_DTM_1m';

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
  const values = rows.flat().filter(Number.isFinite);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const first = Math.ceil(min / intervalMetres) * intervalMetres;
  const levels = [];
  for (let level = first; level <= max; level += intervalMetres) {
    levels.push(Number(level.toFixed(3)));
  }
  return levels;
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
          features.push({
            type: 'Feature',
            properties: {
              elevationMetres: level,
              intervalMetres,
            },
            geometry: {
              type: 'LineString',
              coordinates: [
                bngToGeoJsonCoordinate(intersections[index]),
                bngToGeoJsonCoordinate(intersections[index + 1]),
              ],
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

async function fetchText(url) {
  const response = await fetch(url, { headers: { 'user-agent': 'JobDone Water Walk contour generator' } });
  if (!response.ok) throw new Error(`WCS request failed: ${response.status} ${response.statusText}`);
  return response.text();
}

async function main() {
  const inputPath = resolve(process.cwd(), argValue('--input', 'local/water-walk/dewlish-with-bgs-water-wells.json'));
  const outputPath = resolve(process.cwd(), argValue('--output', 'frontend/public/water-walk/dewlish-contours-2m.geojson'));
  const intervalMetres = Number(argValue('--interval-metres', '2'));
  const scaleFactor = Number(argValue('--scale-factor', '0.02'));
  const bufferMetres = Number(argValue('--buffer-metres', '250'));
  const dataset = await readJson(inputPath);
  const latLonBounds = latLonBoundsFromDataset(dataset);
  const bngBounds = bngBoundsFromLatLonBounds(latLonBounds, bufferMetres);
  const wcsUrl = buildWcsUrl({ bounds: bngBounds, scaleFactor });

  if (hasArg('--print-url')) {
    console.log(wcsUrl);
    return;
  }

  const grid = parseWcsTextGrid(await fetchText(wcsUrl));
  const features = gridToContourFeatures(grid, { intervalMetres });
  const featureCollection = {
    type: 'FeatureCollection',
    properties: {
      schemaVersion: 'jobdone.waterWalkContours.v1',
      generatedAt: new Date().toISOString(),
      source: 'Environment Agency LiDAR Composite DTM 1m WCS',
      sourceUrl: wcsUrl,
      siteId: 'dewlish',
      intervalMetres,
      scaleFactor,
      bounds: bngBounds,
      grid: {
        width: grid.width,
        height: grid.height,
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
