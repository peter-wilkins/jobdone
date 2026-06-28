import { test } from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import { loadCandidates, normalizeCandidatePayload, registerWaterWalkRoutes } from './waterWalk.js';

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
  const payload = normalizeCandidatePayload({
    candidates: [
      {
        name: 'North Test Field',
        centre: [51.5, -0.12],
        priority: 'high',
        theme: 'historic_water',
        score: 12,
        clues: ['high runoff risk'],
      },
    ],
    areas: [
      {
        title: '8 Acres',
        rings: [[[50.1, -2.1], [50.2, -2.1], [50.2, -2.2], [50.1, -2.1]]],
        soilTextureCode: 'hZCL',
      },
    ],
    unmappedClayRichFields: ['River Meadow'],
  });

  assert.equal(payload.candidates.length, 1);
  assert.equal(payload.candidates[0].title, 'North Test Field');
  assert.equal(payload.candidates[0].latitude, 51.5);
  assert.equal(payload.candidates[0].longitude, -0.12);
  assert.equal(payload.candidates[0].theme, 'historic_water');
  assert.deepEqual(payload.candidates[0].whyInteresting, ['high runoff risk']);
  assert.equal(payload.areas.length, 1);
  assert.equal(payload.areas[0].soilTextureCode, 'hZCL');
  assert.deepEqual(payload.unmappedClayRichFields, ['River Meadow']);
});

test('Water Walk candidates are available to allowed account', async () => {
  const app = buildApp({
    loadCandidates: async () => ({
      candidates: [
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
      areas: [],
      unmappedClayRichFields: [],
    }),
  });

  const response = await app.inject({ method: 'GET', url: '/api/water-walk/candidates' });
  assert.equal(response.statusCode, 200);
  assert.equal(response.json().candidates[0].title, 'Private candidate');
});

test('Water Walk candidates are available to Tim by default', async () => {
  const app = Fastify({ logger: false });
  app.register(registerWaterWalkRoutes, {
    requireAuth: async () => ({ email: 'tcwilkins@gmail.com' }),
    loadCandidates: async () => ({
      candidates: [
        {
          id: 'candidate-1',
          title: 'Dewlish candidate',
          latitude: 50,
          longitude: -2,
        },
      ],
      areas: [],
      unmappedClayRichFields: [],
    }),
  });

  const response = await app.inject({ method: 'GET', url: '/api/water-walk/candidates' });
  assert.equal(response.statusCode, 200);
  assert.equal(response.json().candidates[0].title, 'Dewlish candidate');
});

test('loadCandidates reads validated dataset from database before local fallback', async () => {
  const payload = await loadCandidates({
    db: {
      query: async () => ({
        data: [
          {
            payload: {
              candidates: [
                {
                  id: 'db-candidate',
                  title: 'DB candidate',
                  latitude: 50,
                  longitude: -2,
                  priority: 'high',
                  score: 8,
                  whyInteresting: ['database source'],
                  lookFor: ['ditch'],
                  evidencePrompt: 'Check database source.',
                },
              ],
              areas: [],
              unmappedClayRichFields: [],
            },
          },
        ],
        error: null,
      }),
    },
    envJson: JSON.stringify({ candidates: [] }),
    filePath: 'missing-private-water-walk.json',
  });

  assert.equal(payload.candidates[0].id, 'db-candidate');
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
