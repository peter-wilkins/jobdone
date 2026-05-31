import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildCrashReport,
  captureCrash,
  flushCrashReports,
  resetCrashReportsForTests,
  sanitizeCrashDiagnosticBundle,
  startCrashReporting,
} from './crashReportService.js';
import {
  recordApiRequest,
  resetRequestDiagnosticsForTests,
} from './requestDiagnosticsService.js';

function installBrowserGlobals() {
  const storage = new Map();
  const listeners = new Map();
  globalThis.localStorage = {
    getItem: key => storage.get(key) || null,
    setItem: (key, value) => storage.set(key, value),
    removeItem: key => storage.delete(key),
  };
  globalThis.window = {
    location: { pathname: '/', hash: '#home' },
    navigator: {
      userAgent: 'test-browser',
      platform: 'test-platform',
      language: 'en-GB',
      onLine: true,
    },
    matchMedia: () => ({ matches: false }),
    screen: { width: 390, height: 844 },
    devicePixelRatio: 2,
    setTimeout: (fn) => {
      fn();
      return 1;
    },
    addEventListener: (type, fn) => {
      listeners.set(type, fn);
    },
    removeEventListener: (type) => {
      listeners.delete(type);
    },
    __listeners: listeners,
  };
}

function removeBrowserGlobals() {
  delete globalThis.localStorage;
  delete globalThis.window;
}

test('builds compact crash reports with recent request ids', () => {
  installBrowserGlobals();
  resetCrashReportsForTests();
  resetRequestDiagnosticsForTests();
  recordApiRequest({
    requestId: 'req_abcdefghijkl',
    endpoint: '/api/sync/save',
    method: 'POST',
    status: 500,
    ok: false,
    failureKind: 'http_error',
  });

  const report = buildCrashReport(new TypeError('Boom'), { source: 'window_error' });

  assert.equal(report.source, 'window_error');
  assert.equal(report.error.name, 'TypeError');
  assert.equal(report.error.message, 'Boom');
  assert.equal(report.route.screen, 'home');
  assert.deepEqual(report.recent_request_ids, ['req_abcdefghijkl']);
  assert.ok(report.signature);

  removeBrowserGlobals();
});

test('sanitizes crash diagnostic privacy exclusions', () => {
  const bundle = sanitizeCrashDiagnosticBundle({
    recent_events: [
      { event: 'screen_open' },
      { event: 'report_issue_opened' },
      { event: 'issue_report_typed_created' },
    ],
    privacy: { excludes: ['entry content'] },
  });

  assert.equal(bundle.report_type, 'crash_report');
  assert.deepEqual(bundle.recent_events.map(event => event.event), ['screen_open']);
  assert.ok(bundle.privacy.excludes.includes('auth/session data'));
  assert.ok(bundle.privacy.excludes.includes('IndexedDB dumps'));
});

test('flushes pending crash reports once per build and signature window', async () => {
  installBrowserGlobals();
  resetCrashReportsForTests();
  resetRequestDiagnosticsForTests();
  let saved = 0;
  const api = {
    async saveCrashReport(payload) {
      saved += 1;
      assert.equal(payload.diagnostic_bundle.report_type, 'crash_report');
      return { success: true };
    },
  };

  captureCrash(new Error('Looping crash'));
  const first = await flushCrashReports({ api });
  captureCrash(new Error('Looping crash'));
  const second = await flushCrashReports({ api });

  assert.equal(saved, 1);
  assert.equal(first.sent, 1);
  assert.equal(second.skipped, 1);

  removeBrowserGlobals();
});

test('starts listeners and automatically sends captured runtime errors', async () => {
  installBrowserGlobals();
  resetCrashReportsForTests();
  let saved = 0;
  const statuses = [];
  const api = {
    async saveCrashReport() {
      saved += 1;
      return { success: true };
    },
  };

  const stop = startCrashReporting({
    api,
    onStatus: status => statuses.push(status.kind),
  });
  window.__listeners.get('error')({ error: new Error('Runtime broke') });
  await Promise.resolve();
  await Promise.resolve();

  assert.equal(saved, 1);
  assert.ok(statuses.includes('captured'));
  assert.ok(statuses.includes('sent'));

  stop();
  removeBrowserGlobals();
});
