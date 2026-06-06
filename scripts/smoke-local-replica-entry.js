import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createUuidV7 } from '../shared/contracts/clientId.js';
import { registerLocalReplicaRoutes } from '../backend/src/routes/localReplica.js';
import { createLocalReplicaStore } from '../backend/src/services/localReplicaStore.js';
import { createMemoryLocalReplicaStore } from '../frontend/src/services/localReplicaSyncAdapter.js';
import { syncEntryReplica } from '../frontend/src/services/localReplicaEntryService.js';

const backendRequire = createRequire(new URL('../backend/package.json', import.meta.url));
const Fastify = backendRequire('fastify');
const pg = backendRequire('pg');
const { Pool } = pg;

function requiredEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

async function injectJson(app, method, url, body) {
  const response = await app.inject({
    method,
    url,
    headers: {
      'content-type': 'application/json',
      'x-jobdone-device-id': 'local-replica-entry-smoke',
    },
    body: JSON.stringify(body),
  });
  assert.equal(response.statusCode, 200, response.body);
  return JSON.parse(response.body);
}

function makeFrontendDb(store, entry) {
  const savedEntries = [];
  return {
    getLocalReplicaState: store.getLocalReplicaState.bind(store),
    saveLocalReplicaState: store.saveLocalReplicaState.bind(store),
    saveLocalReplicaIntent: store.saveLocalReplicaIntent.bind(store),
    listPendingIntents: store.listPendingIntents.bind(store),
    markLocalReplicaIntentSettled: store.markLocalReplicaIntentSettled.bind(store),
    materializeLocalReplicaObject: store.materializeLocalReplicaObject.bind(store),
    getConfirmedEntriesPendingLocalReplica: async () => [entry],
    getEntry: async () => null,
    putLocalReplicaEntry: async (nextEntry) => {
      savedEntries.push(nextEntry);
      return nextEntry;
    },
    savedEntries,
  };
}

async function countSmokeObjects(pool, schema, ownerId, objectId) {
  const result = await pool.query(`
    SELECT count(*)::int AS count
    FROM "${schema}"."syncObjects"
    WHERE "ownerKind" = 'user'
      AND "ownerId" = $1
      AND "collection" = 'entries'
      AND "id" = $2
  `, [ownerId, objectId]);
  return Number(result.rows[0]?.count || 0);
}

async function main() {
  const connectionString = process.env.LOCAL_REPLICA_DB_URL
    || requiredEnv('JOBDONE_STAGING_SUPABASE_DB_URL');
  const schema = process.env.LOCAL_REPLICA_SCHEMA || 'jobdone_next';
  const pool = new Pool({ connectionString });
  const store = createLocalReplicaStore({ pool, schema });
  const actor = {
    id: createUuidV7(),
    email: 'local-replica-entry-smoke@example.invalid',
  };
  const entryId = createUuidV7();
  const entry = {
    id: entryId,
    status: 'confirmed',
    syncStatus: 'pending',
    summary: 'Local Replica staging smoke entry',
    transcript: 'Local Replica staging smoke entry transcript',
    createdAt: new Date().toISOString(),
    locations: [],
    contacts: [],
    attachments: [],
    workContexts: [],
  };

  const app = Fastify({ logger: false });
  await registerLocalReplicaRoutes(app, {
    requireAuth: async () => actor,
    localReplicaStore: store,
  });
  await app.ready();

  try {
    const frontendStore = createMemoryLocalReplicaStore();
    const frontendDb = makeFrontendDb(frontendStore, entry);
    const api = {
      pushLocalReplica: request => injectJson(app, 'POST', '/api/local-replica/push', request),
      pullLocalReplica: request => injectJson(app, 'POST', '/api/local-replica/pull', request),
    };

    const result = await syncEntryReplica({
      db: frontendDb,
      api,
      auth: {
        isLoggedIn: () => true,
        getUserId: () => actor.id,
      },
    });

    assert.equal(result.skipped, false);
    assert.equal(result.pushed, 1);
    assert.equal(result.materialized, 1);
    assert.equal(frontendDb.savedEntries.length, 1);
    assert.equal(frontendDb.savedEntries[0].id, entryId);
    assert.equal(frontendDb.savedEntries[0].summary, 'Local Replica staging smoke entry');
    assert.equal(await countSmokeObjects(pool, schema, actor.id, entryId), 1);

    console.log(JSON.stringify({
      ok: true,
      schema,
      actorUserId: actor.id,
      entryId,
      pushed: result.pushed,
      pulled: result.pulled,
      materialized: result.materialized,
    }, null, 2));
  } finally {
    await app.close();
    await pool.end();
  }
}

main().catch(error => {
  console.error(error.message || error);
  process.exit(1);
});
