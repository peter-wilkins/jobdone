import assert from 'node:assert/strict';
import test from 'node:test';
import {
  findReusableLocation,
  locationsHaveStrongIdentityMatch,
} from './locationIdentityService.js';

test('reuses a Location with an exact normalized display label', () => {
  const existing = { id: 'location-1', displayName: '14 Bell Street' };
  const incoming = { displayName: '14   bell street' };

  assert.equal(locationsHaveStrongIdentityMatch(existing, incoming), true);
  assert.equal(findReusableLocation([existing], incoming), existing);
});

test('reuses a Location with the same postcode and first address line', () => {
  assert.equal(locationsHaveStrongIdentityMatch(
    { displayName: '14 Bell Street', addressText: '14 Bell Street, London SW1A 1AA' },
    { displayName: 'Bell Street job', addressText: '14 Bell Street, SW1A1AA' }
  ), true);
});

test('reuses a Location with the same provider place id', () => {
  assert.equal(locationsHaveStrongIdentityMatch(
    { displayName: 'Old provider label', providerPlaceId: 'places/abc123' },
    { displayName: 'New provider label', provider_place_id: 'places/abc123' }
  ), true);
});

test('does not silently merge nearby but distinct labels', () => {
  assert.equal(locationsHaveStrongIdentityMatch(
    { displayName: '14 Bell Street', latitude: 51.5, longitude: -0.1 },
    { displayName: '16 Bell Street', latitude: 51.50001, longitude: -0.10001 }
  ), false);
});
