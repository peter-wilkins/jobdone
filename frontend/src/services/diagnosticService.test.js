import assert from 'node:assert/strict';
import test from 'node:test';
import { diagnosticService } from './diagnosticService.js';
import {
  recordApiRequest,
  resetRequestDiagnosticsForTests,
} from './requestDiagnosticsService.js';

function installBrowserGlobals() {
  const storage = new Map();
  globalThis.localStorage = {
    getItem: key => storage.get(key) || null,
    setItem: (key, value) => storage.set(key, value),
    removeItem: key => storage.delete(key),
  };
  globalThis.window = {
    location: { pathname: '/share-target', hash: '#feedback' },
    navigator: {
      userAgent: 'test-browser',
      platform: 'test-platform',
      language: 'en-GB',
      onLine: true,
    },
    matchMedia: () => ({ matches: false }),
    screen: { width: 390, height: 844 },
    devicePixelRatio: 2,
  };
}

function removeBrowserGlobals() {
  delete globalThis.localStorage;
  delete globalThis.window;
}

test('includes recent API request ids in diagnostic bundle', async () => {
  installBrowserGlobals();
  resetRequestDiagnosticsForTests();
  recordApiRequest({
    requestId: 'req_abcdefghijkl',
    endpoint: '/api/feedback/save',
    method: 'POST',
    status: 500,
    ok: false,
    durationMs: 23,
    failureKind: 'http_error',
  });

  const bundle = await diagnosticService.buildBundle({
    screen: 'report_issue',
    backendAvailable: false,
  });

  assert.equal(bundle.route.screen, 'report_issue');
  assert.equal(bundle.recent_api_requests.length, 1);
  assert.equal(bundle.recent_api_requests[0].request_id, 'req_abcdefghijkl');
  assert.equal(JSON.stringify(bundle).includes('auth token'), false);

  removeBrowserGlobals();
});
