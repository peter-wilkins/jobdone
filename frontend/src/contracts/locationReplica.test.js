import assert from 'node:assert/strict';
import test from 'node:test';
import {
  parseLocationReplicaManifestRequest,
  parseLocationReplicaPushRequest,
  parseLocationReplicaRecordsResponse,
} from './locationReplica.js';

const LOCATION_ID = '01973e36-4c80-7abc-8a72-111111111111';

test('Location Replica accepts UUIDv7 Client IDs and active status', () => {
  const result = parseLocationReplicaPushRequest({
    locations: [{
      id: LOCATION_ID,
      status: 'active',
      displayName: '14 Bell Street',
      placeText: 'Workshop',
      addressText: '14 Bell Street, Testville',
      latitude: 51.5,
      longitude: -0.1,
      providerPlaceId: 'google-place-1',
      contentHash: 'hash-1',
      createdAt: '2026-06-05T12:00:00.000Z',
      updatedAt: '2026-06-05T12:01:00.000Z',
    }],
  });

  assert.equal(result.success, true);
  assert.equal(result.data.locations[0].id, LOCATION_ID);
});

test('Location Replica rejects remote and legacy identity fields', () => {
  const result = parseLocationReplicaPushRequest({
    locations: [{
      id: LOCATION_ID,
      remoteId: 'server-id',
      displayName: '14 Bell Street',
    }],
  });

  assert.equal(result.success, false);
  assert.match(result.error, /remoteId must not cross/);
});

test('Location Replica rejects non-UUIDv7 ids', () => {
  const result = parseLocationReplicaManifestRequest({
    locations: [{
      id: 'location-local-1',
      contentHash: 'hash-1',
      identityKeys: [],
      updatedAt: '2026-06-05T12:01:00.000Z',
    }],
  });

  assert.equal(result.success, false);
  assert.match(result.error, /UUIDv7/);
});

test('Location Replica response rejects snake case fields', () => {
  const result = parseLocationReplicaRecordsResponse({
    success: true,
    locations: [{
      id: LOCATION_ID,
      display_name: '14 Bell Street',
    }],
    aliases: [],
  });

  assert.equal(result.success, false);
  assert.equal(result.error, 'Use locations.0.displayName, not locations.0.display_name');
});
