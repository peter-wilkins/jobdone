import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import {
  isValidRequestId,
  registerRequestIdHooks,
  REQUEST_ID_HEADER,
} from './requestId.js';

async function buildApp() {
  const app = Fastify({ logger: false });
  registerRequestIdHooks(app);
  app.get('/echo-request-id', async (request) => ({
    request_id: request.requestId,
  }));
  await app.ready();
  return app;
}

describe('Request ID hooks', () => {
  test('accepts valid frontend request id and returns it as a response header', async () => {
    const app = await buildApp();

    const res = await app.inject({
      method: 'GET',
      url: '/echo-request-id',
      headers: {
        [REQUEST_ID_HEADER]: 'req_frontendvalid123',
      },
    });

    assert.equal(res.statusCode, 200);
    assert.equal(res.headers[REQUEST_ID_HEADER], 'req_frontendvalid123');
    assert.equal(JSON.parse(res.body).request_id, 'req_frontendvalid123');
  });

  test('generates opaque request id when incoming header is missing or invalid', async () => {
    const app = await buildApp();

    const res = await app.inject({
      method: 'GET',
      url: '/echo-request-id',
      headers: {
        [REQUEST_ID_HEADER]: 'user@example.com',
      },
    });
    const requestId = res.headers[REQUEST_ID_HEADER];

    assert.equal(res.statusCode, 200);
    assert.equal(isValidRequestId(requestId), true);
    assert.equal(requestId.includes('@'), false);
    assert.equal(JSON.parse(res.body).request_id, requestId);
  });
});
