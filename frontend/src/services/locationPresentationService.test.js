import assert from 'node:assert/strict';
import test from 'node:test';
import {
  entryMatchesLocation,
  locationNeedsDetail,
  locationMapsUrl,
  locationPrimaryLabel,
  locationSecondaryDetail,
} from './locationPresentationService.js';

test('builds readable Location labels and secondary detail', () => {
  const location = {
    displayName: '14 Bell Street',
    addressText: '14 Bell Street, London SW1A 1AA',
  };

  assert.equal(locationPrimaryLabel(location), '14 Bell Street');
  assert.equal(locationSecondaryDetail(location), '14 Bell Street, London SW1A 1AA');
});

test('uses coordinate detail for mappable approximate Locations', () => {
  const location = {
    displayName: 'North field gate',
    latitude: 52.198123,
    longitude: -0.293456,
  };

  assert.equal(locationSecondaryDetail(location), '52.19812, -0.29346');
  assert.match(locationMapsUrl(location), /query=52\.198123,-0\.293456/);
});

test('does not treat default 0,0 coordinates as mappable', () => {
  const location = {
    displayName: 'Barn near Little Barford',
    latitude: 0,
    longitude: 0,
  };

  assert.equal(locationSecondaryDetail(location), 'Needs detail');
  assert.equal(locationNeedsDetail(location), true);
  assert.equal(locationMapsUrl(location), 'https://www.google.com/maps/search/?api=1&query=Barn%20near%20Little%20Barford');
});

test('identifies anchored Locations as not needing detail', () => {
  assert.equal(locationNeedsDetail({ displayName: '14 Bell Street', addressText: '14 Bell Street' }), false);
  assert.equal(locationNeedsDetail({ displayName: 'North field', latitude: 52.1, longitude: -0.2 }), false);
});

test('matches Entries by confirmed Location association only', () => {
  const location = { id: 'location-1', displayName: '14 Bell Street' };

  assert.equal(entryMatchesLocation({
    id: 'entry-1',
    status: 'confirmed',
    locationIds: ['location-1'],
  }, location), true);

  assert.equal(entryMatchesLocation({
    id: 'entry-2',
    status: 'confirmed',
    locationSnapshots: [{ id: 'location-1' }],
  }, location), true);

  assert.equal(entryMatchesLocation({
    id: 'entry-3',
    status: 'confirmed',
    locationSnapshots: [{ id: 'location-2' }],
  }, location), false);
});
