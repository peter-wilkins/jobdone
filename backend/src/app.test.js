import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from './app.js';

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
