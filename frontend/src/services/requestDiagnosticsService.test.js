import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createRequestId,
  fetchWithRequestDiagnostics,
  isValidRequestId,
  recentApiErrorDetails,
  recentApiRequests,
  recordApiRequest,
  resetRequestDiagnosticsForTests,
  setApiErrorDetailsEnabled,
} from './requestDiagnosticsService.js';

function installStorage() {
  const storage = new Map();
  globalThis.localStorage = {
    getItem: key => storage.get(key) || null,
    setItem: (key, value) => storage.set(key, value),
    removeItem: key => storage.delete(key),
  };
}

function removeGlobals() {
  delete globalThis.localStorage;
  delete globalThis.fetch;
}

test('creates opaque valid request ids', () => {
  const id = createRequestId();

  assert.equal(isValidRequestId(id), true);
  assert.match(id, /^req_/);
  assert.equal(id.includes('@'), false);
});

test('records sanitized API request diagnostics', () => {
  installStorage();
  resetRequestDiagnosticsForTests();

  recordApiRequest({
    requestId: 'req_abcdefghijkl',
    endpoint: '/api/feedback/save?ignored=true',
    method: 'post',
    status: 500,
    ok: false,
    durationMs: 12.4,
    failureKind: 'http_error',
  });

  assert.deepEqual(recentApiRequests(), [{
    request_id: 'req_abcdefghijkl',
    endpoint: '/api/feedback/save?ignored=true',
    method: 'POST',
    status: 500,
    ok: false,
    duration_ms: 12,
    failure_kind: 'http_error',
    at: recentApiRequests()[0].at,
  }]);

  removeGlobals();
});

test('adds request id header and records response status', async () => {
  installStorage();
  resetRequestDiagnosticsForTests();
  let capturedHeaders;
  globalThis.fetch = async (_url, options) => {
    capturedHeaders = options.headers;
    return { status: 201, ok: true };
  };

  const response = await fetchWithRequestDiagnostics('https://api.example.test/api/sync/save', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
  });
  const [request] = recentApiRequests();

  assert.equal(response.status, 201);
  assert.equal(isValidRequestId(capturedHeaders['x-jobdone-request-id']), true);
  assert.equal(capturedHeaders['Content-Type'], 'application/json');
  assert.equal(request.endpoint, '/api/sync/save');
  assert.equal(request.method, 'POST');
  assert.equal(request.status, 201);
  assert.equal(request.ok, true);

  removeGlobals();
});

test('records sanitized non-200 response detail only when debug details are enabled', async () => {
  installStorage();
  resetRequestDiagnosticsForTests();
  setApiErrorDetailsEnabled(true);
  let capturedBody;
  globalThis.fetch = async (_url, options) => {
    capturedBody = options.body;
    return new Response(JSON.stringify({
      error: 'Use createdAt, not created_at',
      token: 'secret-token',
      details: { field: 'created_at' },
    }), {
      status: 400,
      statusText: 'Bad Request',
      headers: {
        'content-type': 'application/json',
        'x-jobdone-build': 'abc1234',
        'x-jobdone-request-id': 'req_backend123456',
      },
    });
  };

  const response = await fetchWithRequestDiagnostics('https://api.example.test/api/sync/save', {
    method: 'POST',
    body: JSON.stringify({ entryData: { summary: 'private words' } }),
  });
  const [detail] = recentApiErrorDetails();

  assert.equal(response.status, 400);
  assert.equal(detail.endpoint, '/api/sync/save');
  assert.equal(detail.method, 'POST');
  assert.equal(detail.status, 400);
  assert.equal(detail.backendBuild, 'abc1234');
  assert.equal(detail.responseBody.error, 'Use createdAt, not created_at');
  assert.equal(detail.responseBody.token, undefined);
  assert.equal(JSON.stringify(detail).includes('private words'), false);
  assert.match(capturedBody, /private words/);

  removeGlobals();
});

test('does not retain non-200 response bodies when debug details are disabled', async () => {
  installStorage();
  resetRequestDiagnosticsForTests();
  globalThis.fetch = async () => new Response(JSON.stringify({ error: 'server unavailable' }), {
    status: 503,
    headers: { 'content-type': 'application/json' },
  });

  await fetchWithRequestDiagnostics('https://api.example.test/api/sync/save', { method: 'POST' });

  assert.deepEqual(recentApiErrorDetails(), []);

  removeGlobals();
});

test('records network failures without request bodies', async () => {
  installStorage();
  resetRequestDiagnosticsForTests();
  globalThis.fetch = async () => {
    throw new Error('network down');
  };

  await assert.rejects(
    fetchWithRequestDiagnostics('https://api.example.test/api/recall', {
      method: 'POST',
      body: JSON.stringify({ query: 'private words' }),
    }),
    /network down/
  );

  const [request] = recentApiRequests();
  assert.equal(request.endpoint, '/api/recall');
  assert.equal(request.failure_kind, 'network_error');
  assert.equal(JSON.stringify(request).includes('private words'), false);

  removeGlobals();
});
