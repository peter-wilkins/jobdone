import assert from 'node:assert/strict';
import test from 'node:test';
import {
  parseLocationReplicaPullRequest,
  parseLocationReplicaPushRequest,
} from './locationReplica.js';

const LOCATION_ID = '01973e36-4c80-7abc-8a72-111111111111';

test('backend Location Replica contract accepts UUIDv7 Client IDs', () => {
  const result = parseLocationReplicaPullRequest({ ids: [LOCATION_ID] });

  assert.equal(result.success, true);
  assert.deepEqual(result.data.ids, [LOCATION_ID]);
});

test('backend Location Replica contract rejects backend id leaks', () => {
  const result = parseLocationReplicaPushRequest({
    locations: [{
      id: LOCATION_ID,
      serverId: 'server-1',
      displayName: '14 Bell Street',
    }],
  });

  assert.equal(result.success, false);
  assert.match(result.error, /serverId must not cross/);
});
