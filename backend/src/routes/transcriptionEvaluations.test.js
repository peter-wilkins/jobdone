import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import { registerTranscriptionEvaluationRoutes } from './transcriptionEvaluations.js';

async function buildApp(deps = {}) {
  const app = Fastify({ logger: false });
  await app.register(registerTranscriptionEvaluationRoutes, deps);
  await app.ready();
  return app;
}

function body(overrides = {}) {
  return {
    anonymous_device_id: 'dev-123',
    captureId: 'entry-123',
    selectedSource: 'backend',
    reviewText: 'fixed the shed door',
    candidates: [
      {
        source: 'backend',
        provider: 'deepgram',
        transcript: 'fixed the shed door',
        selectable: true,
        selected: true,
        latencyMs: 900,
        status: 'ok',
      },
      {
        source: 'local',
        provider: 'whisper.cpp',
        transcript: '',
        selectable: false,
        selected: false,
        reason: 'runtime_not_integrated',
        status: 'placeholder',
      },
    ],
    ...overrides,
  };
}

describe('TranscriptionEvaluationRoute POST /api/transcription-evaluations', () => {
  test('saves anonymous evaluation records with device identity', async () => {
    let receivedIdentity;
    let receivedEvaluation;
    const app = await buildApp({
      optionalAuth: async () => null,
      saveTranscriptionEvaluation: async (identity, evaluation) => {
        receivedIdentity = identity;
        receivedEvaluation = evaluation;
        return { id: 'eval-1' };
      },
    });

    const res = await app.inject({
      method: 'POST',
      url: '/api/transcription-evaluations',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body()),
    });

    assert.equal(res.statusCode, 200);
    assert.deepEqual(JSON.parse(res.body), { success: true, evaluation: { id: 'eval-1' } });
    assert.deepEqual(receivedIdentity, { userId: null, anonymousDeviceId: 'dev-123' });
    assert.equal(receivedEvaluation.selectedSource, 'backend');
    assert.equal(receivedEvaluation.candidates.length, 2);
  });

  test('uses authenticated user identity when present', async () => {
    let receivedIdentity;
    const app = await buildApp({
      optionalAuth: async () => ({ id: 'user-123' }),
      saveTranscriptionEvaluation: async (identity) => {
        receivedIdentity = identity;
        return { id: 'eval-2' };
      },
    });

    const res = await app.inject({
      method: 'POST',
      url: '/api/transcription-evaluations',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body()),
    });

    assert.equal(res.statusCode, 200);
    assert.deepEqual(receivedIdentity, { userId: 'user-123', anonymousDeviceId: 'dev-123' });
  });

  test('requires anonymous device id when not logged in', async () => {
    const app = await buildApp({
      optionalAuth: async () => null,
      saveTranscriptionEvaluation: async () => {
        throw new Error('should not save');
      },
    });

    const res = await app.inject({
      method: 'POST',
      url: '/api/transcription-evaluations',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body({ anonymous_device_id: '' })),
    });

    assert.equal(res.statusCode, 400);
    assert.equal(JSON.parse(res.body).error, 'anonymous_device_id required');
  });
});
