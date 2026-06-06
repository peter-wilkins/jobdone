import assert from 'node:assert/strict';
import test from 'node:test';
import {
  parsePullResponse,
  parsePushRequest,
  parseSyncObject,
  parseSyncTransaction,
} from './localReplica.js';

const REPLICA_EPOCH = '01973e36-4c80-7abc-8a72-000000000001';
const USER_ID = '2a091a40-b350-4d2f-9d91-4c4b5042e01f';
const OBJECT_ID = '01973e36-4c80-7abc-8a72-111111111111';
const INTENT_ID = '01973e36-4c80-7abc-8a72-222222222222';

function validSyncObject(overrides = {}) {
  return {
    id: OBJECT_ID,
    ownerKind: 'user',
    ownerId: USER_ID,
    collection: 'entries',
    createdT: 1,
    changedT: 1,
    deletedT: null,
    createdAt: '2026-06-06T12:00:00.000Z',
    changedAt: '2026-06-06T12:00:00.000Z',
    deletedAt: null,
    codec: 'json',
    encryptionMode: 'none',
    payloadJson: { text: 'Fixed tap' },
    payloadBytes: null,
    payloadHash: 'sha256:test',
    schemaVersion: 1,
    ...overrides,
  };
}

test('Local Replica contract accepts generic sync objects', () => {
  const result = parseSyncObject(validSyncObject());

  assert.equal(result.success, true);
  assert.equal(result.data.id, OBJECT_ID);
  assert.equal(result.data.collection, 'entries');
});

test('Local Replica contract rejects snake_case and backend ID leaks', () => {
  const result = parseSyncObject({
    ...validSyncObject(),
    owner_id: USER_ID,
    remoteId: 'backend-private',
  });

  assert.equal(result.success, false);
  assert.match(result.error, /owner_id must not cross|remoteId must not cross/);
});

test('Local Replica contract rejects non-UUIDv7 app-facing IDs', () => {
  const result = parseSyncObject(validSyncObject({
    id: '2a091a40-b350-4d2f-9d91-4c4b5042e01f',
  }));

  assert.equal(result.success, false);
  assert.match(result.error, /UUIDv7/);
});

test('Local Replica transaction contract carries Server T and actor identity', () => {
  const result = parseSyncTransaction({
    t: 7,
    replicaEpoch: REPLICA_EPOCH,
    actorUserId: USER_ID,
    actorEmail: 'peter@example.com',
    actorDeviceId: 'dev-phone',
    source: 'syncPush',
    createdAt: '2026-06-06T12:00:00.000Z',
  });

  assert.equal(result.success, true);
  assert.equal(result.data.t, 7);
});

test('Local Replica pull response uses stable Server T window', () => {
  const result = parsePullResponse({
    replicaEpoch: REPLICA_EPOCH,
    fromT: 1,
    toT: 3,
    hasMore: false,
    objects: [validSyncObject({ changedT: 3 })],
  });

  assert.equal(result.success, true);
  assert.equal(result.data.objects.length, 1);
});

test('Local Replica push request accepts ordered Sync Intents', () => {
  const result = parsePushRequest({
    replicaEpoch: REPLICA_EPOCH,
    baseT: 3,
    intents: [{
      id: INTENT_ID,
      ownerKind: 'user',
      ownerId: USER_ID,
      collection: 'entries',
      action: 'createObject',
      objectId: OBJECT_ID,
      baseObjectT: null,
      payloadJson: { text: 'Fixed tap' },
      payloadHash: 'sha256:test',
      createdAt: '2026-06-06T12:01:00.000Z',
    }],
  });

  assert.equal(result.success, true);
  assert.equal(result.data.intents[0].id, INTENT_ID);
});
