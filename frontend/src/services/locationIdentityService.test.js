import assert from 'node:assert/strict';
import test from 'node:test';
import {
  findReusableLocation,
  locationsHaveStrongIdentityMatch,
} from './locationIdentityService.js';

test('does not reuse a Location with only an exact normalized display label', () => {
  const existing = { id: 'location-1', displayName: '14 Bell Street' };
  const incoming = { displayName: '14   bell street' };

  assert.equal(locationsHaveStrongIdentityMatch(existing, incoming), false);
  assert.equal(findReusableLocation([existing], incoming), null);
});

test('reuses a Location with the same display label and address text', () => {
  assert.equal(locationsHaveStrongIdentityMatch(
    { displayName: '14 Bell Street', addressText: '14 Bell Street, London SW1A 1AA' },
    { displayName: '14 Bell Street', addressText: '14 Bell Street, London SW1A 1AA' }
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

test('reuses a Location with the same display label and coordinates', () => {
  assert.equal(locationsHaveStrongIdentityMatch(
    { displayName: '14 Bell Street', latitude: 51.5, longitude: -0.1 },
    { displayName: '14 bell street', latitude: 51.5000001, longitude: -0.1000001 }
  ), true);
});
