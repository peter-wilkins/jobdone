import assert from 'node:assert/strict';
import test from 'node:test';
import { createLocalReplicaGenerator } from '../../../shared/contracts/localReplicaGenerators.js';
import { createMemoryLocalReplicaStore } from './localReplicaSyncAdapter.js';
import {
  entryFromLocalReplicaObject,
  entryToLocalReplicaPayload,
  mergeReplicaAttachments,
  syncEntryReplica,
} from './localReplicaEntryService.js';

const ACTOR_USER_ID = '2a091a40-b350-4d2f-9d91-4c4b5042e01f';

function createRemoteReplicaApi() {
  let currentT = 0;
  const objects = new Map();

  return {
    async pushLocalReplica(request) {
      const results = [];
      const pushedObjects = [];
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
        objects.set(`${object.ownerKind}:${object.ownerId}:${object.collection}:${object.id}`, object);
        pushedObjects.push(object);
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
        objects: pushedObjects,
      };
    },
    async pullLocalReplica(request) {
      const changed = [...objects.values()].filter(object => object.changedT > request.sinceT);
      return {
        replicaEpoch: request.replicaEpoch,
        fromT: request.sinceT,
        toT: currentT,
        hasMore: false,
        objects: changed,
      };
    },
  };
}

test('Entry Local Replica payload uses durable text and hides legacy sync fields', () => {
  const payload = entryToLocalReplicaPayload({
    id: 'entry-1',
    text: '',
    summary: 'Fixed dripping tap',
    transcript: 'Fixed dripping tap transcript',
    createdAt: '2026-06-06T13:30:00.000Z',
    captureId: 'capture-1',
    remoteId: 'server-1',
    syncStatus: 'pending',
    locations: [{ id: 'location-1', displayName: 'Bell Street' }],
  });

  assert.deepEqual(payload, {
    id: 'entry-1',
    text: 'Fixed dripping tap',
    createdAt: '2026-06-06T13:30:00.000Z',
    locations: [{ id: 'location-1', displayName: 'Bell Street' }],
    contacts: [],
    attachments: [],
    workContexts: [],
  });
  assert.equal(Object.prototype.hasOwnProperty.call(payload, 'summary'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(payload, 'transcript'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(payload, 'remoteId'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(payload, 'captureId'), false);
});

test('Entry Local Replica object materializes into current Entry store shape', () => {
  const generator = createLocalReplicaGenerator(501);
  const object = generator.syncObject({
    id: generator.uuid(),
    ownerKind: 'user',
    ownerId: ACTOR_USER_ID,
    collection: 'entries',
    createdT: 1,
    changedT: 1,
    deletedT: null,
    payloadJson: {
      id: 'entry-remote-1',
      text: 'Serviced boiler',
      createdAt: '2026-06-06T13:31:00.000Z',
      locations: [{ id: 'location-1', displayName: 'Yard' }],
      contacts: [],
      attachments: [],
      workContexts: [],
    },
    payloadHash: 'sha256:entry',
  });

  const entry = entryFromLocalReplicaObject(object);

  assert.equal(entry.id, object.id);
  assert.equal(entry.status, 'confirmed');
  assert.equal(entry.syncStatus, 'synced');
  assert.equal(entry.text, 'Serviced boiler');
  assert.equal(entry.summary, 'Serviced boiler');
  assert.equal(entry.transcript, 'Serviced boiler');
  assert.equal(entry.remoteId, null);
  assert.equal(entry.captureId, null);
  assert.deepEqual(entry.locations, [{ id: 'location-1', displayName: 'Yard' }]);
});

test('Entry Local Replica materialization preserves local Photo blobs', () => {
  const localBlob = new Blob(['photo-bytes'], { type: 'image/jpeg' });
  const entry = entryFromLocalReplicaObject({
    id: 'entry-1',
    ownerKind: 'user',
    ownerId: ACTOR_USER_ID,
    collection: 'entries',
    createdT: 1,
    changedT: 2,
    deletedT: null,
    createdAt: '2026-06-06T13:31:00.000Z',
    changedAt: '2026-06-06T13:32:00.000Z',
    payloadJson: {
      text: 'Photo evidence',
      createdAt: '2026-06-06T13:31:00.000Z',
      attachments: [{
        id: 'attachment-1',
        kind: 'photo',
        status: 'ready',
        filename: 'photo.jpg',
        mimeType: 'image/jpeg',
        size: 11,
      }],
      locations: [],
      contacts: [],
      workContexts: [],
    },
  }, {
    attachments: [{
      id: 'attachment-1',
      kind: 'photo',
      status: 'ready',
      originalName: 'local-photo.jpg',
      blob: localBlob,
      compressionStatus: 'compressed',
    }],
  });

  assert.equal(entry.attachments[0].blob, localBlob);
  assert.equal(entry.attachments[0].filename, 'photo.jpg');
  assert.equal(entry.attachments[0].originalName, 'local-photo.jpg');
  assert.equal(entry.attachments[0].compressionStatus, 'compressed');
});

test('Entry Local Replica attachment merge keeps replica metadata for remote-only attachments', () => {
  assert.deepEqual(
    mergeReplicaAttachments([], [{
      id: 'attachment-remote',
      kind: 'photo',
      status: 'ready',
      filename: 'remote.jpg',
    }]),
    [{
      id: 'attachment-remote',
      kind: 'photo',
      status: 'ready',
      filename: 'remote.jpg',
    }],
  );
});

test('Entry Local Replica sync queues confirmed Entries and materializes accepted objects', async () => {
  const store = createMemoryLocalReplicaStore();
  const savedEntries = [];
  const db = {
    getLocalReplicaState: store.getLocalReplicaState.bind(store),
    saveLocalReplicaState: store.saveLocalReplicaState.bind(store),
    saveLocalReplicaIntent: store.saveLocalReplicaIntent.bind(store),
    listPendingIntents: store.listPendingIntents.bind(store),
    markLocalReplicaIntentSettled: store.markLocalReplicaIntentSettled.bind(store),
    materializeLocalReplicaObject: store.materializeLocalReplicaObject.bind(store),
    getConfirmedEntriesPendingLocalReplica: async () => [{
      id: '01973e36-4c80-7abc-8a72-111111111111',
      status: 'confirmed',
      syncStatus: 'pending',
      summary: 'Fixed sink leak',
      transcript: 'Fixed sink leak transcript',
      createdAt: '2026-06-06T13:32:00.000Z',
      locations: [],
      contacts: [],
      attachments: [],
      workContexts: [],
    }],
    getEntry: async () => null,
    putLocalReplicaEntry: async (entry) => {
      savedEntries.push(entry);
      return entry;
    },
  };

  const result = await syncEntryReplica({
    db,
    api: createRemoteReplicaApi(),
    auth: {
      isLoggedIn: () => true,
      getUserId: () => ACTOR_USER_ID,
    },
  });

  assert.equal(result.pushed, 1);
  assert.equal(result.pulled, 1);
  assert.equal(result.skipped, false);
  assert.equal((await store.listPendingIntents()).length, 0);
  assert.equal(savedEntries.length, 1);
  assert.equal(savedEntries[0].id, '01973e36-4c80-7abc-8a72-111111111111');
  assert.equal(savedEntries[0].syncStatus, 'synced');
  assert.equal(savedEntries[0].summary, 'Fixed sink leak');
});
