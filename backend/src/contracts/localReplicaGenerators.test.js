import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createLocalReplicaGenerator,
  invalidLocalReplicaCases,
  localReplicaSeeds,
  validLocalReplicaCase,
} from '../../../shared/contracts/localReplicaGenerators.js';
import {
  parsePullRequest,
  parsePullResponse,
  parsePushRequest,
  parsePushResponse,
  parseSyncIntent,
  parseSyncObject,
  parseSyncTransaction,
} from './localReplica.js';

const parsers = {
  syncObject: parseSyncObject,
  syncTransaction: parseSyncTransaction,
  syncIntent: parseSyncIntent,
  pullRequest: parsePullRequest,
  pullResponse: parsePullResponse,
  pushRequest: parsePushRequest,
  pushResponse: parsePushResponse,
};

test('Local Replica generators are deterministic by seed', () => {
  assert.deepEqual(validLocalReplicaCase(42), validLocalReplicaCase(42));
  assert.notDeepEqual(validLocalReplicaCase(42), validLocalReplicaCase(43));
});

test('Local Replica generators produce valid sync objects and envelopes', () => {
  for (const seed of localReplicaSeeds(75)) {
    const payloads = validLocalReplicaCase(seed);
    for (const [kind, payload] of Object.entries(payloads)) {
      const result = parsers[kind](payload);
      assert.equal(result.success, true, `${kind} seed ${seed}: ${result.error || 'failed'}`);
    }
  }
});

test('Local Replica invalid generators produce rejected sync objects and envelopes', () => {
  for (const seed of localReplicaSeeds(25)) {
    for (const { kind, name, payload } of invalidLocalReplicaCases(seed)) {
      const result = parsers[kind](payload);
      assert.equal(result.success, false, `${kind} seed ${seed} should fail: ${name}`);
    }
  }
});

test('Local Replica generated envelopes share owner and object references', () => {
  const generator = createLocalReplicaGenerator(7);
  const object = generator.syncObject();
  const pushRequest = generator.pushRequest({
    intents: [generator.syncIntent({
      collection: object.collection,
      objectId: object.id,
    })],
  });
  const pushResponse = generator.pushResponse({
    results: [{
      intentId: pushRequest.intents[0].id,
      status: 'accepted',
      t: object.changedT,
      objectId: object.id,
      reason: null,
    }],
    objects: [object],
  });

  assert.equal(parsePushRequest(pushRequest).success, true);
  assert.equal(parsePushResponse(pushResponse).success, true);
  assert.equal(pushRequest.intents[0].ownerId, object.ownerId);
  assert.equal(pushResponse.results[0].objectId, object.id);
});
