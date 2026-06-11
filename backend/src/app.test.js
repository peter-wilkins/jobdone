import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from './app.js';
import { BUILD_ID_HEADER } from './services/buildInfo.js';

test('accepts compressed photo sync JSON payloads over Fastify default size', async () => {
  const app = createApp({ logger: false });
  app.post('/__body-limit-test', async (request) => ({
    size: request.body?.data?.length || 0,
  }));

  try {
    await app.ready();
    const payload = { data: 'x'.repeat(1024 * 1024 + 1) };
    const response = await app.inject({
      method: 'POST',
      url: '/__body-limit-test',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });

    assert.equal(response.statusCode, 200);
    assert.equal(JSON.parse(response.body).size, payload.data.length);
  } finally {
    await app.close();
  }
});

test('exposes GET /health with expected JSON and build header', async () => {
  const app = createApp({ logger: false });

  try {
    await app.ready();
    const response = await app.inject({
      method: 'GET',
      url: '/health',
    });

    assert.equal(response.statusCode, 200);
    assert.deepEqual(JSON.parse(response.body), {
      status: 'ok',
      service: 'JobDone Backend',
    });
    assert.equal(typeof response.headers[BUILD_ID_HEADER], 'string');
  } finally {
    await app.close();
  }
});
