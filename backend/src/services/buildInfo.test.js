import { test } from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import { BUILD_ID_HEADER, currentBuildId, registerBuildInfoHooks } from './buildInfo.js';

test('derives build id from Vercel git commit short SHA', () => {
  assert.equal(currentBuildId({ VERCEL_GIT_COMMIT_SHA: '5151199abcdef' }), '5151199');
});

test('adds build id response header for API version checks', async () => {
  const app = Fastify({ logger: false });
  registerBuildInfoHooks(app, { buildId: '5151199' });
  app.get('/health', async () => ({ status: 'ok' }));
  await app.ready();

  const res = await app.inject({ method: 'GET', url: '/health' });

  assert.equal(res.statusCode, 200);
  assert.equal(res.headers[BUILD_ID_HEADER], '5151199');
});
