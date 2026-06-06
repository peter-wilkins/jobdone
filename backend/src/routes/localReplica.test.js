import assert from 'node:assert/strict';
import test from 'node:test';
import Fastify from 'fastify';
import { registerLocalReplicaRoutes } from './localReplica.js';

const ACTOR_USER_ID = '2a091a40-b350-4d2f-9d91-4c4b5042e01f';
const REPLICA_EPOCH = '01973e36-4c80-7abc-8a72-000000000001';
const OBJECT_ID = '01973e36-4c80-7abc-8a72-111111111111';
const INTENT_ID = '01973e36-4c80-7abc-8a72-222222222222';

async function buildApp(store) {
  const app = Fastify({ logger: false });
  await registerLocalReplicaRoutes(app, {
    requireAuth: async () => ({ id: ACTOR_USER_ID, email: 'peter@example.com' }),
    localReplicaStore: store,
  });
  await app.ready();
  return app;
}

test('Local Replica push route rejects noncanonical payloads before storage', async () => {
  const app = await buildApp({
    configured: true,
    push: async () => {
      throw new Error('store should not be called');
    },
  });

  try {
    const response = await app.inject({
      method: 'POST',
      url: '/api/local-replica/push',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        replicaEpoch: REPLICA_EPOCH,
        base_t: 0,
        intents: [],
      }),
    });

    assert.equal(response.statusCode, 400);
    assert.match(JSON.parse(response.body).error, /expected number|unrecognized|must not cross/);
  } finally {
    await app.close();
  }
});

test('Local Replica push route returns parsed reconciliation payloads', async () => {
  const app = await buildApp({
    configured: true,
    push: async ({ actorUserId, request }) => {
      assert.equal(actorUserId, ACTOR_USER_ID);
      assert.equal(request.intents.length, 1);
      return {
        replicaEpoch: request.replicaEpoch,
        baseT: request.baseT,
        toT: 1,
        results: [{
          intentId: request.intents[0].id,
          status: 'accepted',
          t: 1,
          objectId: request.intents[0].objectId,
          reason: null,
        }],
        objects: [{
          id: request.intents[0].objectId,
          ownerKind: 'user',
          ownerId: ACTOR_USER_ID,
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
        }],
      };
    },
  });

  try {
    const response = await app.inject({
      method: 'POST',
      url: '/api/local-replica/push',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        replicaEpoch: REPLICA_EPOCH,
        baseT: 0,
        intents: [{
          id: INTENT_ID,
          ownerKind: 'user',
          ownerId: ACTOR_USER_ID,
          collection: 'entries',
          action: 'createObject',
          objectId: OBJECT_ID,
          baseObjectT: null,
          payloadJson: { text: 'Fixed tap' },
          payloadHash: 'sha256:test',
          createdAt: '2026-06-06T12:00:00.000Z',
        }],
      }),
    });

    assert.equal(response.statusCode, 200);
    const body = JSON.parse(response.body);
    assert.equal(body.results[0].status, 'accepted');
    assert.equal(body.objects[0].id, OBJECT_ID);
  } finally {
    await app.close();
  }
});

test('Local Replica pull route returns parsed Server T window', async () => {
  const app = await buildApp({
    configured: true,
    pull: async ({ actorUserId, request }) => {
      assert.equal(actorUserId, ACTOR_USER_ID);
      return {
        replicaEpoch: request.replicaEpoch,
        fromT: request.sinceT,
        toT: 0,
        hasMore: false,
        objects: [],
      };
    },
  });

  try {
    const response = await app.inject({
      method: 'POST',
      url: '/api/local-replica/pull',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        replicaEpoch: REPLICA_EPOCH,
        sinceT: 0,
      }),
    });

    assert.equal(response.statusCode, 200);
    assert.deepEqual(JSON.parse(response.body).objects, []);
  } finally {
    await app.close();
  }
});
