import assert from 'node:assert/strict';
import test from 'node:test';
import { parsePullRequest, parsePushResponse } from './localReplica.js';

const REPLICA_EPOCH = '01973e36-4c80-7abc-8a72-000000000001';
const INTENT_ID = '01973e36-4c80-7abc-8a72-222222222222';
const OBJECT_ID = '01973e36-4c80-7abc-8a72-111111111111';

test('frontend Local Replica contract defaults pull cursor to zero', () => {
  const result = parsePullRequest({ replicaEpoch: REPLICA_EPOCH });

  assert.equal(result.success, true);
  assert.equal(result.data.sinceT, 0);
});

test('frontend Local Replica contract validates push reconciliation responses', () => {
  const result = parsePushResponse({
    replicaEpoch: REPLICA_EPOCH,
    baseT: 3,
    toT: 4,
    results: [{
      intentId: INTENT_ID,
      status: 'accepted',
      t: 4,
      objectId: OBJECT_ID,
    }],
    objects: [],
  });

  assert.equal(result.success, true);
  assert.equal(result.data.results[0].status, 'accepted');
});
