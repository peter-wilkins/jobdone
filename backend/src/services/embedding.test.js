import { test, describe, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import axios from 'axios';
import { createEmbeddingService, EMBEDDING_DIMENSIONS, EMBEDDING_MODEL } from './embedding.js';

function makeVector(value = 0.1) {
  return Array.from({ length: EMBEDDING_DIMENSIONS }, () => value);
}

describe('EmbeddingService', () => {
  const originalVoyageKey = process.env.VOYAGE_API_KEY;

  beforeEach(() => {
    process.env.VOYAGE_API_KEY = 'test-key';
  });

  afterEach(() => {
    mock.restoreAll();
    if (originalVoyageKey === undefined) {
      delete process.env.VOYAGE_API_KEY;
    } else {
      process.env.VOYAGE_API_KEY = originalVoyageKey;
    }
  });

  test('returns a vector with configured embedding dimensions', async () => {
    const expected = makeVector(0.42);
    mock.method(axios, 'post', async () => ({
      data: { data: [{ embedding: expected }] },
    }));

    const svc = createEmbeddingService();
    const result = await svc.embedText('Replaced kitchen tap at the Smith place.');

    assert.ok(Array.isArray(result), 'result should be an array');
    assert.equal(result.length, EMBEDDING_DIMENSIONS);
    assert.deepEqual(result, expected);
  });

  test('calls Voyage embeddings endpoint with expected payload', async () => {
    const expected = makeVector();
    const postMock = mock.method(axios, 'post', async () => ({
      data: { data: [{ embedding: expected }] },
    }));

    const svc = createEmbeddingService();
    await svc.embedText('some summary');

    assert.equal(postMock.mock.calls.length, 1);
    const [url, body] = postMock.mock.calls[0].arguments;
    assert.equal(url, 'https://api.voyageai.com/v1/embeddings');
    assert.equal(body.model, EMBEDDING_MODEL);
    assert.equal(body.input, 'some summary');
  });

  test('propagates API failure errors', async () => {
    mock.method(axios, 'post', async () => {
      throw new Error('Rate limit exceeded');
    });

    const svc = createEmbeddingService();

    await assert.rejects(
      () => svc.embedText('anything'),
      /Rate limit exceeded/
    );
  });

  test('throws on empty input', async () => {
    const svc = createEmbeddingService();
    await assert.rejects(() => svc.embedText(''));
    await assert.rejects(() => svc.embedText(null));
  });

  test('throws when client returns wrong dimension', async () => {
    mock.method(axios, 'post', async () => ({
      data: { data: [{ embedding: [0.1, 0.2, 0.3] }] },
    }));

    const svc = createEmbeddingService();

    await assert.rejects(
      () => svc.embedText('summary'),
      /Unexpected embedding dimensions/
    );
  });

  test('throws when VOYAGE_API_KEY is missing', async () => {
    delete process.env.VOYAGE_API_KEY;
    const svc = createEmbeddingService();

    await assert.rejects(
      () => svc.embedText('summary'),
      /VOYAGE_API_KEY not set/
    );
  });
});
