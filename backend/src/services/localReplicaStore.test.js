import assert from 'node:assert/strict';
import test from 'node:test';
import { LocalReplicaStore, pullWindowForRequest } from './localReplicaStore.js';

const ACTOR_USER_ID = '2a091a40-b350-4d2f-9d91-4c4b5042e01f';
const OBJECT_ID = '01973e36-4c80-7abc-8a72-111111111111';

class ProbeLocalReplicaStore extends LocalReplicaStore {
  constructor({ currentObject }) {
    super({ pool: null, schema: 'jobdone' });
    this.currentObject = currentObject;
    this.persisted = null;
  }

  async findIntent() {
    return null;
  }

  async hasOwnerAccess() {
    return true;
  }

  async findObject() {
    return this.currentObject;
  }

  async persistIntentResult(_client, args) {
    this.persisted = args;
    return { result: args.result, object: args.object };
  }
}

test('idempotent create retry does not claim an old transaction as newly committed', async () => {
  const currentObject = {
    id: OBJECT_ID,
    ownerKind: 'user',
    ownerId: ACTOR_USER_ID,
    collection: 'entries',
    createdT: 2,
    changedT: 2,
    deletedT: null,
    createdAt: '2026-06-06T12:00:00.000Z',
    changedAt: '2026-06-06T12:00:00.000Z',
    deletedAt: null,
    codec: 'json',
    encryptionMode: 'none',
    payloadJson: { id: OBJECT_ID, text: 'Already synced' },
    payloadHash: 'fnv1a:already',
    schemaVersion: 1,
  };
  const store = new ProbeLocalReplicaStore({ currentObject });

  const outcome = await store.applyIntent(null, {
    actorUserId: ACTOR_USER_ID,
    actorEmail: 'peter@example.com',
    actorDeviceId: 'device-1',
    replicaEpoch: '01973e36-4c80-7abc-8a72-000000000001',
    baseT: 8,
    intent: {
      id: '01973e36-4c80-7abc-8a72-222222222222',
      ownerKind: 'user',
      ownerId: ACTOR_USER_ID,
      collection: 'entries',
      action: 'createObject',
      objectId: OBJECT_ID,
      baseObjectT: null,
      payloadJson: { id: OBJECT_ID, text: 'Already synced' },
      payloadHash: 'fnv1a:already',
      createdAt: '2026-06-06T12:01:00.000Z',
    },
  });

  assert.equal(outcome.result.status, 'idempotent');
  assert.equal(outcome.result.t, 2);
  assert.equal(store.persisted.committedT, null);
  assert.equal(store.persisted.baseT, 8);
});

test('pull window resets stale client cursor after disposable schema wipe', () => {
  assert.deepEqual(
    pullWindowForRequest({ sinceT: 42, currentT: 0 }),
    { fromT: 0, toT: 0, reset: true },
  );
  assert.deepEqual(
    pullWindowForRequest({ sinceT: 2, currentT: 5 }),
    { fromT: 2, toT: 5, reset: false },
  );
});
