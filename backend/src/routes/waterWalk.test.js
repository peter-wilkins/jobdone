import { test } from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import { normalizeCandidatePayload, registerWaterWalkRoutes } from './waterWalk.js';

function buildApp({ email = 'poppetew@gmail.com', loadCandidates = async () => [] } = {}) {
  const app = Fastify({ logger: false });
  app.register(registerWaterWalkRoutes, {
    requireAuth: async () => ({ email }),
    loadCandidates,
    allowedEmails: ['poppetew@gmail.com'],
  });
  return app;
}

test('normalizeCandidatePayload accepts RegenOS field-style candidate data', () => {
  const candidates = normalizeCandidatePayload({
    candidates: [
      {
        name: 'Higher Kitehill',
        centre: [50.78, -2.33],
        priority: 'high',
        score: 12,
        clues: ['high runoff risk'],
      },
    ],
  });

  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].title, 'Higher Kitehill');
  assert.equal(candidates[0].latitude, 50.78);
  assert.equal(candidates[0].longitude, -2.33);
  assert.deepEqual(candidates[0].whyInteresting, ['high runoff risk']);
});

test('Water Walk candidates are available to allowed account', async () => {
  const app = buildApp({
    loadCandidates: async () => [
      {
        id: 'candidate-1',
        title: 'Private candidate',
        latitude: 50,
        longitude: -2,
        priority: 'high',
        score: 10,
        whyInteresting: ['test clue'],
        lookFor: ['wet ground'],
        evidencePrompt: 'Take photo',
      },
    ],
  });

  const response = await app.inject({ method: 'GET', url: '/api/water-walk/candidates' });
  assert.equal(response.statusCode, 200);
  assert.equal(response.json().candidates[0].title, 'Private candidate');
});

test('Water Walk candidates are forbidden for other accounts', async () => {
  const app = buildApp({ email: 'someone@example.com' });

  const response = await app.inject({ method: 'GET', url: '/api/water-walk/candidates' });
  assert.equal(response.statusCode, 403);
});

test('Water Walk candidates fail closed when private data is missing', async () => {
  const app = buildApp({
    loadCandidates: async () => {
      throw new Error('missing private data');
    },
  });

  const response = await app.inject({ method: 'GET', url: '/api/water-walk/candidates' });
  assert.equal(response.statusCode, 503);
});
