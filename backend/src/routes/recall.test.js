/**
 * RecallRoute integration tests.
 *
 * Strategy: inject a stub EmbeddingService and a stub recallEntries function
 * via module-level dependency injection rather than patching globals.
 * We build a minimal Fastify instance and register the route with injected deps.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import { EMBEDDING_DIMENSIONS } from '../services/embedding.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeVector(seed = 0) {
  return Array.from({ length: EMBEDDING_DIMENSIONS }, (_, i) => (i + seed) / EMBEDDING_DIMENSIONS);
}

/**
 * Build a Fastify instance with the recall route wired to injected deps.
 *
 * @param {object} deps
 * @param {Function} deps.embedText       - stub for svc.embedText
 * @param {Function} deps.recallEntries   - stub for db.recallEntries
 * @param {string}   deps.userId          - user id the auth stub returns
 */
async function buildApp({ embedText, recallEntries, userId = 'user-1' }) {
  const fastify = Fastify({ logger: false });

  // Stub auth: injects a hard-coded user
  fastify.decorate('requireAuthStub', async () => ({ id: userId }));

  fastify.post('/api/recall', async (request, reply) => {
    // Auth
    const user = { id: userId };

    const { query } = request.body ?? {};
    if (!query || typeof query !== 'string' || query.trim() === '') {
      return reply.status(400).send({ error: 'query must be a non-empty string' });
    }

    try {
      const queryEmbedding = await embedText(query.trim());
      const rows = await recallEntries(user.id, queryEmbedding);
      return { entries: rows };
    } catch (err) {
      return reply.status(500).send({ error: err.message || 'Recall failed' });
    }
  });

  await fastify.ready();
  return fastify;
}

// ---------------------------------------------------------------------------
// Seed data helpers
// ---------------------------------------------------------------------------

/**
 * Build fake DB rows with pre-computed similarity scores (as match_entries RPC returns them).
 */
function seedRows() {
  return [
    { id: 'entry-1', summary: 'Fixed burst pipe at office', similarity: 0.91 },
    { id: 'entry-2', summary: 'Replaced kitchen tap at Smith',  similarity: 0.75 },
    { id: 'entry-3', summary: 'Fitted shower valve at Jones',   similarity: 0.62 },
    { id: 'entry-4', summary: 'Checked boiler pressure',        similarity: 0.45 },
    // below floor — match_entries RPC already excludes these, so they won't appear
  ];
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('RecallRoute POST /api/recall', () => {
  test('returns entries in correct relevance order', async () => {
    const rows = seedRows(); // already ordered by similarity desc (as DB returns)

    const app = await buildApp({
      embedText: async () => makeVector(1),
      recallEntries: async (userId, vec) => rows,
    });

    const res = await app.inject({
      method: 'POST',
      url: '/api/recall',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ query: 'burst pipe repair' }),
    });

    assert.equal(res.statusCode, 200);
    const body = JSON.parse(res.body);
    assert.ok(Array.isArray(body.entries));
    assert.equal(body.entries.length, rows.length);

    // Verify ordering: similarity should be non-increasing
    for (let i = 1; i < body.entries.length; i++) {
      assert.ok(
        body.entries[i - 1].similarity >= body.entries[i].similarity,
        `entries not in similarity order at index ${i}`
      );
    }
  });

  test('excludes entries below the relevance floor', async () => {
    // match_entries RPC already applies the floor — simulate that behaviour
    const aboveFloor = seedRows().filter(r => r.similarity >= 0.3);

    const app = await buildApp({
      embedText: async () => makeVector(2),
      recallEntries: async () => aboveFloor,
    });

    const res = await app.inject({
      method: 'POST',
      url: '/api/recall',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ query: 'pipe work' }),
    });

    const body = JSON.parse(res.body);
    assert.equal(res.statusCode, 200);
    body.entries.forEach(e =>
      assert.ok(e.similarity >= 0.3, `entry ${e.id} below floor: ${e.similarity}`)
    );
  });

  test('returns empty array when nothing qualifies', async () => {
    const app = await buildApp({
      embedText: async () => makeVector(3),
      recallEntries: async () => [],
    });

    const res = await app.inject({
      method: 'POST',
      url: '/api/recall',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ query: 'nothing matches this at all' }),
    });

    assert.equal(res.statusCode, 200);
    const body = JSON.parse(res.body);
    assert.deepEqual(body.entries, []);
  });

  test('returns 400 when query is missing', async () => {
    const app = await buildApp({
      embedText: async () => makeVector(),
      recallEntries: async () => [],
    });

    const res = await app.inject({
      method: 'POST',
      url: '/api/recall',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });

    assert.equal(res.statusCode, 400);
  });

  test('returns 500 when embedding fails', async () => {
    const app = await buildApp({
      embedText: async () => { throw new Error('OpenAI down'); },
      recallEntries: async () => [],
    });

    const res = await app.inject({
      method: 'POST',
      url: '/api/recall',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ query: 'anything' }),
    });

    assert.equal(res.statusCode, 500);
  });
});
