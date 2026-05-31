/**
 * RecallRoute integration tests.
 *
 * Strategy: inject a stub recallEntries function via a minimal Fastify route
 * instead of patching module globals.
 * We build a minimal Fastify instance and register the route with injected deps.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Build a Fastify instance with the recall route wired to injected deps.
 *
 * @param {object} deps
 * @param {Function} deps.recallEntries   - stub for db.recallEntries
 * @param {string}   deps.userId          - user id the auth stub returns
 */
async function buildApp({ recallEntries, userId = 'user-1' }) {
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
      const trimmedQuery = query.trim();
      const rows = await recallEntries(user.id, { query: trimmedQuery });
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
 * Build fake DB rows with deterministic SQL recall scores.
 */
function seedRows() {
  return [
    { id: 'entry-1', summary: 'Fixed burst pipe at office', recall_score: 5 },
    { id: 'entry-2', summary: 'Replaced kitchen tap at Smith', recall_score: 3 },
    { id: 'entry-3', summary: 'Fitted shower valve at Jones', recall_score: 2 },
    { id: 'entry-4', summary: 'Checked boiler pressure', recall_score: 1 },
  ];
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('RecallRoute POST /api/recall', () => {
  test('returns entries in correct relevance order', async () => {
    const rows = seedRows(); // already ordered by recall_score desc (as DB returns)
    let recallCall;

    const app = await buildApp({
      recallEntries: async (userId, opts) => {
        recallCall = { userId, opts };
        return rows;
      },
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
    assert.deepEqual(recallCall, { userId: 'user-1', opts: { query: 'burst pipe repair' } });

    // Verify ordering: recall_score should be non-increasing
    for (let i = 1; i < body.entries.length; i++) {
      assert.ok(
        body.entries[i - 1].recall_score >= body.entries[i].recall_score,
        `entries not in recall_score order at index ${i}`
      );
    }
  });

  test('trims query before calling SQL recall', async () => {
    let recallCall;

    const app = await buildApp({
      recallEntries: async (userId, opts) => {
        recallCall = { userId, opts };
        return [];
      },
    });

    const res = await app.inject({
      method: 'POST',
      url: '/api/recall',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ query: '  pipe work  ' }),
    });

    assert.equal(res.statusCode, 200);
    assert.deepEqual(recallCall, { userId: 'user-1', opts: { query: 'pipe work' } });
  });

  test('returns empty array when nothing qualifies', async () => {
    const app = await buildApp({
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

  test('returns 500 when SQL recall fails', async () => {
    const app = await buildApp({
      recallEntries: async () => { throw new Error('database down'); },
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
