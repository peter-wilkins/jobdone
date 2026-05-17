import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import { registerSyncRoutes } from './sync.js';
import { EMBEDDING_DIMENSIONS, EMBEDDING_MODEL } from '../services/embedding.js';

function makeEntry(overrides = {}) {
  return {
    transcript: 'Fixed a dripping kitchen tap.',
    summary: 'Fixed dripping kitchen tap.',
    materials: ['washer'],
    labour_minutes: 20,
    follow_ups: [],
    possible_future_work: '',
    created_at: '2026-05-17T01:00:00.000Z',
    ...overrides,
  };
}

function makeVector() {
  return Array.from({ length: EMBEDDING_DIMENSIONS }, () => 0.1);
}

async function buildApp(deps = {}) {
  const app = Fastify({ logger: false });
  await registerSyncRoutes(app, {
    requireAuth: async () => ({ id: 'user-1' }),
    getEntries: async () => [],
    getPeople: async () => [],
    getEntryByCreatedAt: async () => null,
    deleteUserData: async () => ({ success: true }),
    ...deps,
  });
  await app.ready();
  return app;
}

describe('SyncRoute POST /api/sync/save', () => {
  test('embeds before saving and stores embedding on inserted entry', async () => {
    const vector = makeVector();
    let savedArgs;

    const app = await buildApp({
      embeddingService: {
        embedText: async (text) => {
          assert.equal(text, 'Fixed dripping kitchen tap.');
          return vector;
        },
      },
      saveEntry: async (userId, entryData) => {
        savedArgs = { userId, entryData };
        return { id: 'entry-1', ...entryData };
      },
    });

    const res = await app.inject({
      method: 'POST',
      url: '/api/sync/save',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ entryData: makeEntry() }),
    });

    assert.equal(res.statusCode, 200);
    assert.equal(savedArgs.userId, 'user-1');
    assert.deepEqual(savedArgs.entryData.embedding, vector);
    assert.equal(savedArgs.entryData.embedding_model, EMBEDDING_MODEL);
  });

  test('does not create an entry when embedding fails', async () => {
    let saveCalled = false;

    const app = await buildApp({
      embeddingService: {
        embedText: async () => {
          throw new Error('embedding API down');
        },
      },
      saveEntry: async () => {
        saveCalled = true;
      },
    });

    const res = await app.inject({
      method: 'POST',
      url: '/api/sync/save',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ entryData: makeEntry() }),
    });

    assert.equal(res.statusCode, 500);
    assert.equal(saveCalled, false);
    assert.match(JSON.parse(res.body).error, /embedding API down/);
  });

  test('returns existing entry for duplicate captureId without embedding or inserting', async () => {
    let embedCalled = false;
    let saveCalled = false;
    const existing = { id: 'entry-existing', capture_id: 'capture-1', ...makeEntry() };

    const app = await buildApp({
      getEntryByCaptureId: async (userId, captureId) => {
        assert.equal(userId, 'user-1');
        assert.equal(captureId, 'capture-1');
        return existing;
      },
      embeddingService: {
        embedText: async () => {
          embedCalled = true;
          return makeVector();
        },
      },
      saveEntry: async () => {
        saveCalled = true;
      },
    });

    const res = await app.inject({
      method: 'POST',
      url: '/api/sync/save',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ entryData: makeEntry({ captureId: 'capture-1' }) }),
    });

    assert.equal(res.statusCode, 200);
    assert.equal(embedCalled, false);
    assert.equal(saveCalled, false);
    assert.deepEqual(JSON.parse(res.body).entry, existing);
  });

  test('falls back to created_at when no captureId is provided', async () => {
    let embedCalled = false;
    let saveCalled = false;
    const existing = { id: 'entry-existing', ...makeEntry() };

    const app = await buildApp({
      getEntryByCreatedAt: async (userId, createdAt) => {
        assert.equal(userId, 'user-1');
        assert.equal(createdAt, existing.created_at);
        return existing;
      },
      embeddingService: {
        embedText: async () => {
          embedCalled = true;
          return makeVector();
        },
      },
      saveEntry: async () => {
        saveCalled = true;
      },
    });

    const res = await app.inject({
      method: 'POST',
      url: '/api/sync/save',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ entryData: makeEntry() }),
    });

    assert.equal(res.statusCode, 200);
    assert.equal(embedCalled, false);
    assert.equal(saveCalled, false);
    assert.deepEqual(JSON.parse(res.body).entry, existing);
  });
});

describe('SyncRoute People sync', () => {
  test('saves local-first people for authenticated user', async () => {
    let savedArgs;
    const app = await buildApp({
      savePerson: async (userId, person) => {
        savedArgs = { userId, person };
        return { id: 'person-cloud-1', user_id: userId, local_id: person.localId };
      },
    });

    const res = await app.inject({
      method: 'POST',
      url: '/api/sync/people',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        people: [{ localId: 'person-local-1', displayName: 'Ann Smith' }],
      }),
    });

    assert.equal(res.statusCode, 200);
    assert.equal(savedArgs.userId, 'user-1');
    assert.equal(savedArgs.person.displayName, 'Ann Smith');
    assert.equal(JSON.parse(res.body).people[0].local_id, 'person-local-1');
  });

  test('fetches cloud people for authenticated user', async () => {
    const cloudPeople = [{ id: 'person-cloud-1', display_name: 'Ann Smith' }];
    const app = await buildApp({
      getPeople: async (userId) => {
        assert.equal(userId, 'user-1');
        return cloudPeople;
      },
    });

    const res = await app.inject({
      method: 'GET',
      url: '/api/sync/people',
    });

    assert.equal(res.statusCode, 200);
    assert.deepEqual(JSON.parse(res.body).people, cloudPeople);
  });
});
