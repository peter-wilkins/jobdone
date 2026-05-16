import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createEmbeddingService, EMBEDDING_DIMENSIONS, EMBEDDING_MODEL } from './embedding.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeVector(value = 0.1) {
  return Array.from({ length: EMBEDDING_DIMENSIONS }, () => value);
}

function makeMockClient({ vector, shouldFail = false, failMessage = 'OpenAI error' } = {}) {
  return {
    embeddings: {
      create: async ({ model, input }) => {
        if (shouldFail) throw new Error(failMessage);
        return {
          data: [{ embedding: vector ?? makeVector() }],
          model,
          object: 'list',
        };
      },
    },
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('EmbeddingService', () => {
  test('returns a 1536-dimension vector', async () => {
    const svc = createEmbeddingService(makeMockClient());
    const result = await svc.embedText('Replaced kitchen tap at the Smith place.');

    assert.ok(Array.isArray(result), 'result should be an array');
    assert.equal(result.length, EMBEDDING_DIMENSIONS);
    result.forEach(v => assert.equal(typeof v, 'number'));
  });

  test('vector values match mock client output', async () => {
    const expected = makeVector(0.42);
    const svc = createEmbeddingService(makeMockClient({ vector: expected }));
    const result = await svc.embedText('some summary');

    assert.deepEqual(result, expected);
  });

  test('throws clearly on OpenAI API failure', async () => {
    const svc = createEmbeddingService(makeMockClient({ shouldFail: true, failMessage: 'Rate limit exceeded' }));

    await assert.rejects(
      () => svc.embedText('anything'),
      (err) => {
        assert.ok(err.message.includes('OpenAI API failure'), `Expected "OpenAI API failure" in: ${err.message}`);
        assert.ok(err.message.includes('Rate limit exceeded'), `Expected original message in: ${err.message}`);
        return true;
      }
    );
  });

  test('throws on empty input', async () => {
    const svc = createEmbeddingService(makeMockClient());
    await assert.rejects(() => svc.embedText(''));
    await assert.rejects(() => svc.embedText(null));
  });

  test('throws when client returns wrong dimension', async () => {
    const badVector = [0.1, 0.2, 0.3]; // only 3 dims
    const svc = createEmbeddingService(makeMockClient({ vector: badVector }));

    await assert.rejects(
      () => svc.embedText('summary'),
      /Unexpected embedding dimensions/
    );
  });
});
