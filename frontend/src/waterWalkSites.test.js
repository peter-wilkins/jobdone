import assert from 'node:assert/strict';
import test from 'node:test';
import { WATER_WALK_SITES, waterWalkScreenForSite, waterWalkSiteFromHash } from './waterWalkSites.js';

test('water walk site defaults to Dewlish', () => {
  assert.equal(waterWalkSiteFromHash('#water-walk').id, 'dewlish');
});

test('water walk site can be selected from hash query', () => {
  assert.equal(waterWalkSiteFromHash('#water-walk?site=85-dover-road').label, '85 Dover Road');
});

test('water walk site can open the Tumptonics restoration map', () => {
  const site = waterWalkSiteFromHash('#water-walk?site=tumptonics');
  assert.equal(site.label, 'Tumptonics');
  assert.equal(site.defaultView.latitude, 51.66535);
  assert.equal(site.seedDataset.candidates.length, 2);
  assert.equal(site.lidarLayer.kind, 'wales_public_links');
  assert.match(site.lidarLayer.hillshadeCogUrl, /wales_hillshade/);
});

test('water walk site screen keeps the existing water-walk route', () => {
  assert.equal(waterWalkScreenForSite('85-dover-road'), 'water-walk?site=85-dover-road');
});

test('water walk sites declare bounded search scopes', () => {
  for (const site of WATER_WALK_SITES) {
    assert.ok(site.searchScope);
    assert.ok(site.searchScope.radiusMetres > 0);
  }
});
