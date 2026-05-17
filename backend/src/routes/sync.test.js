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
});
