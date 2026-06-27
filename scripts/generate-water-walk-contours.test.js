import assert from 'node:assert/strict';
import test from 'node:test';

import {
  bngBoundsFromLatLonBounds,
  buildWcsUrl,
  gridToContourFeatures,
  latLonBoundsFromDataset,
  parseWcsTextGrid,
} from './generate-water-walk-contours.js';

test('latLonBoundsFromDataset prefers mapped areas over wider candidate search pins', () => {
  const bounds = latLonBoundsFromDataset({
    candidates: [{ latitude: 50.1, longitude: -2.1 }],
    areas: [{ rings: [[[50.2, -2.4], [50.3, -2.2], [50.4, -2.3]]] }],
  });

  assert.deepEqual(bounds, {
    south: 50.2,
    west: -2.4,
    north: 50.4,
    east: -2.2,
  });
});

test('latLonBoundsFromDataset falls back to candidates when there are no areas', () => {
  const bounds = latLonBoundsFromDataset({
    candidates: [{ latitude: 50.1, longitude: -2.1 }, { latitude: 50.4, longitude: -2.4 }],
    areas: [],
  });

  assert.deepEqual(bounds, {
    south: 50.1,
    west: -2.4,
    north: 50.4,
    east: -2.1,
  });
});

test('bngBoundsFromLatLonBounds returns buffered British National Grid bounds', () => {
  const bounds = bngBoundsFromLatLonBounds({ south: 50.78, west: -2.34, north: 50.79, east: -2.32 }, 10);

  assert.ok(bounds.minE < bounds.maxE);
  assert.ok(bounds.minN < bounds.maxN);
  assert.ok(bounds.minE > 370000);
  assert.ok(bounds.maxE < 380000);
});

test('buildWcsUrl requests scaled elevation text from EA WCS', () => {
  const url = buildWcsUrl({ bounds: { minE: 1, maxE: 2, minN: 3, maxN: 4 }, scaleFactor: 0.02 });

  assert.match(url, /request=GetCoverage/);
  assert.match(url, /format=text%2Fplain/);
  assert.match(url, /subset=E%281%2C2%29/);
  assert.match(url, /subset=N%283%2C4%29/);
  assert.match(url, /scaleFactor=0.02/);
});

test('parseWcsTextGrid extracts bounds and numeric rows', () => {
  const grid = parseWcsTextGrid(`Grid bounds: GeneralBounds[(10.0, 20.0), (12.0, 22.0)]\nIgnored metadata\n1 2 3\n4 5 6\n`);

  assert.equal(grid.width, 3);
  assert.equal(grid.height, 2);
  assert.deepEqual(grid.bounds, { minE: 10, minN: 20, maxE: 12, maxN: 22 });
  assert.deepEqual(grid.rows, [[1, 2, 3], [4, 5, 6]]);
});

test('gridToContourFeatures generates contour line segments', () => {
  const features = gridToContourFeatures({
    bounds: { minE: 376800, minN: 98700, maxE: 376820, maxN: 98720 },
    width: 2,
    height: 2,
    rows: [
      [1, 3],
      [3, 1],
    ],
  }, { intervalMetres: 2 });

  assert.equal(features.length, 2);
  assert.equal(features[0].properties.elevationMetres, 2);
  assert.equal(features[0].geometry.type, 'LineString');
  assert.equal(features[0].geometry.coordinates.length, 2);
});
