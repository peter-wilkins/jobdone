import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import Fastify from 'fastify';
import pg from 'pg';
import { createLocalReplicaGenerator, localReplicaSeeds } from '../../../shared/contracts/localReplicaGenerators.js';
import { registerLocalReplicaRoutes } from '../routes/localReplica.js';
import { createLocalReplicaStore, LocalReplicaStore } from './localReplicaStore.js';

const { Pool } = pg;

const DB_URL = process.env.LOCAL_REPLICA_PROPERTY_DB_URL;
const SCHEMA_SQL_PATH = new URL('../../../supabase/create_jobdone_next_local_replica.sql', import.meta.url);

async function resetSchema(pool) {
  const sql = await readFile(SCHEMA_SQL_PATH, 'utf8');
  await pool.query(sql);
}

async function buildApp(store, actor) {
  const app = Fastify({ logger: false });
  await registerLocalReplicaRoutes(app, {
    requireAuth: async () => actor,
    localReplicaStore: store,
  });
  await app.ready();
  return app;
}

async function postJson(app, url, payload) {
  const response = await app.inject({
    method: 'POST',
    url,
    headers: { 'content-type': 'application/json', 'x-jobdone-device-id': 'property-device' },
    body: JSON.stringify(payload),
  });
  assert.equal(response.statusCode, 200, response.body);
  return JSON.parse(response.body);
}

function byId(objects = []) {
  return new Map(objects.map(object => [object.id, object]));
}

class ProbeLocalReplicaStore extends LocalReplicaStore {
  constructor({ currentObject }) {
    super({ pool: null, schema: 'jobdone_next' });
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

test('Local Replica backend property loop keeps idempotent create retries DB-check safe', async () => {
  const actorUserId = '2a091a40-b350-4d2f-9d91-4c4b5042e01f';

  for (const seed of localReplicaSeeds(24, 600)) {
    const generator = createLocalReplicaGenerator(seed);
    const objectId = generator.uuid();
    const changedT = 1 + (seed % 7);
    const baseT = changedT + 1 + (seed % 5);
    const payloadHash = `sha256:idempotent:${seed}`;
    const currentObject = generator.syncObject({
      id: objectId,
      ownerKind: 'user',
      ownerId: actorUserId,
      collection: 'entries',
      createdT: changedT,
      changedT,
      deletedT: null,
      payloadJson: { id: objectId, text: `already synced ${seed}` },
      payloadHash,
    });
    const store = new ProbeLocalReplicaStore({ currentObject });

    const outcome = await store.applyIntent(null, {
      actorUserId,
      actorEmail: 'property@example.com',
      actorDeviceId: 'property-device',
      replicaEpoch: generator.uuid(),
      baseT,
      intent: generator.syncIntent({
        ownerKind: 'user',
        ownerId: actorUserId,
        collection: 'entries',
        action: 'createObject',
        objectId,
        baseObjectT: null,
        payloadJson: { id: objectId, text: `already synced ${seed}` },
        payloadHash,
      }),
    });

    assert.equal(outcome.result.status, 'idempotent', `seed ${seed} idempotent`);
    assert.equal(outcome.result.t, changedT, `seed ${seed} reports existing object T`);
    assert.equal(store.persisted.committedT, null, `seed ${seed} no fake committedT`);
    assert.ok(
      store.persisted.committedT == null || store.persisted.committedT >= store.persisted.baseT,
      `seed ${seed} mirrors syncIntents committedT check`,
    );
  }
});

test('Local Replica backend property loop pushes generated intents then pulls matching objects', {
  skip: DB_URL ? false : 'Set LOCAL_REPLICA_PROPERTY_DB_URL to run local Postgres property loop',
}, async () => {
  const pool = new Pool({ connectionString: DB_URL });
  const store = createLocalReplicaStore({ pool, schema: 'jobdone_next' });
  const actorUserId = '2a091a40-b350-4d2f-9d91-4c4b5042e01f';
  const actor = { id: actorUserId, email: 'property@example.com' };
  const app = await buildApp(store, actor);

  try {
    await resetSchema(pool);

    for (const seed of localReplicaSeeds(12, 200)) {
      const generator = createLocalReplicaGenerator(seed);
      const objectId = generator.uuid();
      const replicaEpoch = generator.uuid();

      const createIntent = generator.syncIntent({
        ownerKind: 'user',
        ownerId: actorUserId,
        collection: 'entries',
        action: 'createObject',
        objectId,
        baseObjectT: null,
        payloadJson: { id: objectId, text: `created ${seed}`, seed },
        payloadHash: `sha256:create:${seed}`,
      });
      const created = await postJson(app, '/api/local-replica/push', {
        replicaEpoch,
        baseT: 0,
        intents: [createIntent],
      });
      assert.equal(created.results[0].status, 'accepted', `seed ${seed} create`);
      assert.equal(created.objects[0].payloadJson.text, `created ${seed}`);

      const retry = await postJson(app, '/api/local-replica/push', {
        replicaEpoch,
        baseT: 0,
        intents: [createIntent],
      });
      assert.equal(retry.results[0].status, 'accepted', `seed ${seed} same-intent retry`);
      assert.equal(retry.results[0].t, created.results[0].t);

      const duplicateCreate = generator.syncIntent({
        ownerKind: 'user',
        ownerId: actorUserId,
        collection: 'entries',
        action: 'createObject',
        objectId,
        baseObjectT: null,
        payloadJson: { id: objectId, text: `created ${seed}`, seed },
        payloadHash: `sha256:create:${seed}`,
      });
      const advanceObjectId = generator.uuid();
      const advanceIntent = generator.syncIntent({
        ownerKind: 'user',
        ownerId: actorUserId,
        collection: 'entries',
        action: 'createObject',
        objectId: advanceObjectId,
        baseObjectT: null,
        payloadJson: { id: advanceObjectId, text: `advance server t ${seed}`, seed },
        payloadHash: `sha256:advance:${seed}`,
      });
      const advanced = await postJson(app, '/api/local-replica/push', {
        replicaEpoch,
        baseT: created.toT,
        intents: [advanceIntent],
      });
      assert.equal(advanced.results[0].status, 'accepted', `seed ${seed} advance`);

      const duplicate = await postJson(app, '/api/local-replica/push', {
        replicaEpoch,
        baseT: advanced.toT,
        intents: [duplicateCreate],
      });
      assert.equal(duplicate.results[0].status, 'idempotent', `seed ${seed} same-hash create`);

      const updateIntent = generator.syncIntent({
        ownerKind: 'user',
        ownerId: actorUserId,
        collection: 'entries',
        action: 'updateObject',
        objectId,
        baseObjectT: created.objects[0].changedT,
        payloadJson: { id: objectId, text: `updated ${seed}`, seed },
        payloadHash: `sha256:update:${seed}`,
      });
      const updated = await postJson(app, '/api/local-replica/push', {
        replicaEpoch,
        baseT: advanced.toT,
        intents: [updateIntent],
      });
      assert.equal(updated.results[0].status, 'accepted', `seed ${seed} update`);

      const staleIntent = generator.syncIntent({
        ownerKind: 'user',
        ownerId: actorUserId,
        collection: 'entries',
        action: 'updateObject',
        objectId,
        baseObjectT: created.objects[0].changedT,
        payloadJson: { id: objectId, text: `stale ${seed}`, seed },
        payloadHash: `sha256:stale:${seed}`,
      });
      const stale = await postJson(app, '/api/local-replica/push', {
        replicaEpoch,
        baseT: updated.toT,
        intents: [staleIntent],
      });
      assert.equal(stale.results[0].status, 'conflict', `seed ${seed} stale update`);
      assert.equal(stale.objects[0].payloadJson.text, `updated ${seed}`);

      const pulledUpdate = await postJson(app, '/api/local-replica/pull', {
        replicaEpoch,
        sinceT: created.objects[0].changedT,
        limit: 100,
      });
      const updatedObjects = byId(pulledUpdate.objects);
      assert.equal(updatedObjects.get(objectId).payloadJson.text, `updated ${seed}`);

      const deleteIntent = generator.syncIntent({
        ownerKind: 'user',
        ownerId: actorUserId,
        collection: 'entries',
        action: 'deleteObject',
        objectId,
        baseObjectT: updated.objects[0].changedT,
        payloadJson: {},
        payloadHash: `sha256:delete:${seed}`,
      });
      const deleted = await postJson(app, '/api/local-replica/push', {
        replicaEpoch,
        baseT: updated.toT,
        intents: [deleteIntent],
      });
      assert.equal(deleted.results[0].status, 'accepted', `seed ${seed} delete`);
      assert.equal(typeof deleted.objects[0].deletedT, 'number');

      const pulledDelete = await postJson(app, '/api/local-replica/pull', {
        replicaEpoch,
        sinceT: updated.objects[0].changedT,
        limit: 100,
      });
      const deletedObjects = byId(pulledDelete.objects);
      assert.equal(deletedObjects.get(objectId).deletedT, deleted.objects[0].deletedT);
    }
  } finally {
    await app.close();
    await pool.end();
  }
});
