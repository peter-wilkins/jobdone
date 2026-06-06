import assert from 'node:assert/strict';
import test from 'node:test';
import {
  invalidLocalReplicaCases,
  localReplicaSeeds,
  validLocalReplicaCase,
} from '../../../shared/contracts/localReplicaGenerators.js';
import {
  parsePullResponse,
  parsePushRequest,
  parseSyncObject,
} from './localReplica.js';

test('frontend can reuse Local Replica generated valid envelopes', () => {
  for (const seed of localReplicaSeeds(20, 100)) {
    const payloads = validLocalReplicaCase(seed);

    assert.equal(parseSyncObject(payloads.syncObject).success, true);
    assert.equal(parsePullResponse(payloads.pullResponse).success, true);
    assert.equal(parsePushRequest(payloads.pushRequest).success, true);
  }
});

test('frontend rejects generated invalid Local Replica examples', () => {
  const rejected = invalidLocalReplicaCases(101)
    .filter(testCase => ['syncObject', 'pullResponse', 'pushRequest'].includes(testCase.kind))
    .map(testCase => {
      const parser = {
        syncObject: parseSyncObject,
        pullResponse: parsePullResponse,
        pushRequest: parsePushRequest,
      }[testCase.kind];
      return parser(testCase.payload).success;
    });

  assert.deepEqual(rejected, rejected.map(() => false));
});
