import assert from 'node:assert/strict';
import test from 'node:test';
import { createLocalReplicaGenerator, localReplicaSeeds } from '../../../shared/contracts/localReplicaGenerators.js';
import {
  createMemoryLocalReplicaStore,
  queueCreateObjectIntent,
  syncLocalReplicaOnce,
} from './localReplicaSyncAdapter.js';

function byCollectionId(snapshot, collection, id) {
  return snapshot.collections[collection]?.find(object => object.id === id) || null;
}

function createRemoteReplicaApi({ objects = [], startT = 0 } = {}) {
  const remoteObjects = new Map(objects.map(object => [`${object.ownerKind}:${object.ownerId}:${object.collection}:${object.id}`, object]));
  let currentT = Math.max(startT, ...objects.map(object => object.changedT || 0));

  return {
    async pushLocalReplica(request) {
      const acceptedObjects = [];
      const results = [];

      for (const intent of request.intents || []) {
        currentT += 1;
        const object = {
          id: intent.objectId,
          ownerKind: intent.ownerKind,
          ownerId: intent.ownerId,
          collection: intent.collection,
          createdT: currentT,
          changedT: currentT,
          deletedT: null,
          createdAt: intent.createdAt,
          changedAt: intent.createdAt,
          deletedAt: null,
          codec: 'json',
          encryptionMode: 'none',
          payloadJson: intent.payloadJson,
          payloadBytes: null,
          payloadHash: intent.payloadHash,
          schemaVersion: 1,
        };
        remoteObjects.set(`${object.ownerKind}:${object.ownerId}:${object.collection}:${object.id}`, object);
        acceptedObjects.push(object);
        results.push({
          intentId: intent.id,
          status: 'accepted',
          t: currentT,
          objectId: intent.objectId,
          reason: null,
        });
      }

      return {
        replicaEpoch: request.replicaEpoch,
        baseT: request.baseT,
        toT: currentT,
        results,
        objects: acceptedObjects,
      };
    },

    async pullLocalReplica(request) {
      const changed = [...remoteObjects.values()]
        .filter(object => object.changedT > request.sinceT)
        .sort((left, right) => left.changedT - right.changedT || left.id.localeCompare(right.id));
      const limit = request.limit || 100;
      return {
        replicaEpoch: request.replicaEpoch,
        fromT: request.sinceT,
        toT: currentT,
        hasMore: changed.length > limit,
        objects: changed.slice(0, limit),
      };
    },
  };
}

test('Local Replica frontend property loop preserves pre-existing remote objects after local push', async () => {
  for (const seed of localReplicaSeeds(12, 300)) {
    const generator = createLocalReplicaGenerator(seed);
    const ownerScope = generator.ownerScope();
    const replicaEpoch = generator.uuid();
    const remoteId = generator.uuid();
    const localId = generator.uuid();
    const remoteObject = generator.syncObject({
      id: remoteId,
      ...ownerScope,
      collection: 'locations',
      createdT: 1,
      changedT: 1,
      deletedT: null,
      payloadJson: { id: remoteId, text: `remote location ${seed}` },
      payloadHash: `sha256:remote:${seed}`,
    });
    const store = createMemoryLocalReplicaStore({ replicaEpoch });
    const api = createRemoteReplicaApi({ objects: [remoteObject] });

    await queueCreateObjectIntent({
      store,
      ownerScope,
      collection: 'entries',
      objectId: localId,
      payloadJson: { id: localId, text: `local entry ${seed}` },
      now: generator.timestamp(1000),
    });

    const result = await syncLocalReplicaOnce({ store, api, limit: 50 });
    const snapshot = await store.getMaterializedSnapshot();

    assert.equal(result.pushed, 1, `seed ${seed} pushed`);
    assert.ok(byCollectionId(snapshot, 'entries', localId), `seed ${seed} local object materialized`);
    assert.ok(byCollectionId(snapshot, 'locations', remoteId), `seed ${seed} remote object materialized`);
    assert.equal((await store.listPendingIntents()).length, 0, `seed ${seed} settled intents`);

    const second = await syncLocalReplicaOnce({ store, api, limit: 50 });
    assert.equal(second.pushed, 0, `seed ${seed} second sync idempotent`);
    assert.equal(second.pulled, 0, `seed ${seed} second sync does not replay`);
  }
});

test('Local Replica create intent queueing reuses generated pending and settled-success intents', async () => {
  for (const seed of localReplicaSeeds(24, 700)) {
    const generator = createLocalReplicaGenerator(seed);
    const ownerScope = generator.ownerScope();
    const objectId = generator.uuid();
    const payloadJson = { id: objectId, text: `same local entry ${seed}` };
    const store = createMemoryLocalReplicaStore({ replicaEpoch: generator.uuid() });

    const first = await queueCreateObjectIntent({
      store,
      ownerScope,
      collection: 'entries',
      objectId,
      payloadJson,
      now: generator.timestamp(1000),
    });
    const duplicatePending = await queueCreateObjectIntent({
      store,
      ownerScope,
      collection: 'entries',
      objectId,
      payloadJson,
      now: generator.timestamp(2000),
    });
    assert.equal(duplicatePending.id, first.id, `seed ${seed} reuses pending intent`);
    assert.equal((await store.listPendingIntents()).length, 1, `seed ${seed} has one pending intent`);

    await store.markLocalReplicaIntentSettled(first.id, {
      intentId: first.id,
      status: seed % 2 === 0 ? 'accepted' : 'idempotent',
      t: seed + 1,
      objectId,
      reason: null,
    });
    const duplicateSettled = await queueCreateObjectIntent({
      store,
      ownerScope,
      collection: 'entries',
      objectId,
      payloadJson,
      now: generator.timestamp(3000),
    });
    assert.equal(duplicateSettled.id, first.id, `seed ${seed} reuses settled success intent`);
    assert.equal((await store.listPendingIntents()).length, 0, `seed ${seed} does not requeue settled success`);
  }
});

test('Local Replica frontend materializer applies generated tombstones idempotently', async () => {
  for (const seed of localReplicaSeeds(10, 400)) {
    const generator = createLocalReplicaGenerator(seed);
    const ownerScope = generator.ownerScope();
    const replicaEpoch = generator.uuid();
    const objectId = generator.uuid();
    const liveObject = generator.syncObject({
      id: objectId,
      ...ownerScope,
      collection: 'entries',
      createdT: 1,
      changedT: 1,
      deletedT: null,
      payloadJson: { id: objectId, text: `live then deleted ${seed}` },
      payloadHash: `sha256:live:${seed}`,
    });
    const deletedObject = generator.syncObject({
      ...liveObject,
      changedT: 2,
      deletedT: 2,
      changedAt: generator.timestamp(2),
      deletedAt: generator.timestamp(2),
      payloadHash: `sha256:deleted:${seed}`,
    });
    const store = createMemoryLocalReplicaStore({ replicaEpoch });

    const api = createRemoteReplicaApi({ objects: [liveObject] });
    await syncLocalReplicaOnce({ store, api });
    assert.ok(byCollectionId(await store.getMaterializedSnapshot(), 'entries', objectId), `seed ${seed} live object exists`);

    const tombstoneApi = createRemoteReplicaApi({ objects: [deletedObject] });
    await syncLocalReplicaOnce({ store, api: tombstoneApi });
    await syncLocalReplicaOnce({ store, api: tombstoneApi });

    assert.equal(byCollectionId(await store.getMaterializedSnapshot(), 'entries', objectId), null, `seed ${seed} tombstone removes object`);
  }
});
