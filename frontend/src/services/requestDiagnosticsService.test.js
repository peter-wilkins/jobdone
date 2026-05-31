import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createRequestId,
  fetchWithRequestDiagnostics,
  isValidRequestId,
  recentApiRequests,
  recordApiRequest,
  resetRequestDiagnosticsForTests,
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
