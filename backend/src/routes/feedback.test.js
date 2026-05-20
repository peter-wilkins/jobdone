import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import { registerFeedbackRoutes } from './feedback.js';

async function buildApp(deps = {}) {
  const app = Fastify({ logger: false });
  await registerFeedbackRoutes(app, {
    requireAuth: async () => ({ id: 'user-1' }),
    optionalAuth: async () => ({ id: 'user-1' }),
    getFeedback: async () => [],
    saveFeedback: async (_userId, report) => ({ id: 'feedback-1', ...report }),
    checkAnonymousFeedbackRateLimit: () => ({ allowed: true, abuseKeyHash: 'abuse-hash', resetAt: Date.now() + 1000 }),
    ...deps,
  });
  await app.ready();
  return app;
}

describe('FeedbackRoute POST /api/feedback/save', () => {
  test('stores transcript and diagnostic bundle for the authenticated user', async () => {
    let savedArgs;
    const app = await buildApp({
      saveFeedback: async (userId, report) => {
        savedArgs = { userId, report };
        return { id: 'feedback-1', ...report };
      },
    });

    const diagnosticBundle = {
      build_id: 'abc123',
      route: { screen: 'report_issue' },
      recent_events: [{ event: 'screen_open', at: '2026-05-18T10:00:00.000Z' }],
    };

    const res = await app.inject({
      method: 'POST',
      url: '/api/feedback/save',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        transcript: 'Recording spinner was stuck.',
        created_at: '2026-05-18T10:01:00.000Z',
        diagnostic_bundle: diagnosticBundle,
      }),
    });

    assert.equal(res.statusCode, 200);
    assert.equal(savedArgs.userId, 'user-1');
    assert.equal(savedArgs.report.transcript, 'Recording spinner was stuck.');
    assert.deepEqual(savedArgs.report.diagnostic_bundle, diagnosticBundle);
    assert.equal(savedArgs.report.identity_class, 'signed_in');
  });

  test('stores anonymous reports with device identity and abuse key', async () => {
    let savedArgs;
    const app = await buildApp({
      optionalAuth: async () => null,
      saveFeedback: async (userId, report) => {
        savedArgs = { userId, report };
        return { id: 'feedback-1', ...report };
      },
      checkAnonymousFeedbackRateLimit: () => ({
        allowed: true,
        abuseKeyHash: 'server-derived-abuse-key',
        resetAt: Date.now() + 1000,
      }),
    });

    const res = await app.inject({
      method: 'POST',
      url: '/api/feedback/save',
      headers: { 'content-type': 'application/json', 'user-agent': 'test-browser' },
      body: JSON.stringify({
        transcript: 'Login was broken.',
        anonymous_device_id: 'fbd_abcdefghijkl',
        created_at: '2026-05-18T10:01:00.000Z',
        diagnostic_bundle: { build_id: 'abc123' },
      }),
    });

    assert.equal(res.statusCode, 200);
    assert.equal(savedArgs.userId, null);
    assert.equal(savedArgs.report.identity_class, 'anonymous');
    assert.equal(savedArgs.report.anonymous_device_id, 'fbd_abcdefghijkl');
    assert.equal(savedArgs.report.abuse_key_hash, 'server-derived-abuse-key');
  });

  test('rate limits anonymous reports server-side', async () => {
    const app = await buildApp({
      optionalAuth: async () => null,
      checkAnonymousFeedbackRateLimit: () => ({
        allowed: false,
        abuseKeyHash: 'server-derived-abuse-key',
        resetAt: Date.now() + 5000,
      }),
    });

    const res = await app.inject({
      method: 'POST',
      url: '/api/feedback/save',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        transcript: 'Too many reports.',
        anonymous_device_id: 'fbd_abcdefghijkl',
      }),
    });

    assert.equal(res.statusCode, 429);
    assert.equal(res.headers['retry-after'], '5');
  });

  test('rejects empty reports', async () => {
    const app = await buildApp();

    const res = await app.inject({
      method: 'POST',
      url: '/api/feedback/save',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ transcript: '' }),
    });

    assert.equal(res.statusCode, 400);
  });
});

describe('FeedbackRoute POST /api/crash-reports', () => {
  test('stores anonymous crash reports as typed feedback diagnostics', async () => {
    let savedArgs;
    const app = await buildApp({
      optionalAuth: async () => null,
      saveFeedback: async (userId, report) => {
        savedArgs = { userId, report };
        return { id: 'crash-1', ...report };
      },
      checkAnonymousFeedbackRateLimit: () => ({
        allowed: true,
        abuseKeyHash: 'crash-abuse-key',
        resetAt: Date.now() + 1000,
      }),
    });

    const res = await app.inject({
      method: 'POST',
      url: '/api/crash-reports',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        anonymous_device_id: 'fbd_abcdefghijkl',
        crash_report: {
          crash_id: 'crash_123',
          signature: 'TypeError:boom:app',
          captured_at: '2026-05-20T10:00:00.000Z',
          build_id: 'build-1',
          route: { screen: 'home', path: '/', hash: '' },
          error: {
            name: 'TypeError',
            message: 'Boom',
            stack: 'TypeError: Boom\n    at App.jsx:1',
          },
          recent_request_ids: ['req_abcdefghijkl'],
        },
        diagnostic_bundle: {
          build_id: 'build-1',
          route: { screen: 'home' },
          recent_events: [{ event: 'screen_open' }],
        },
      }),
    });

    assert.equal(res.statusCode, 200);
    assert.equal(savedArgs.userId, null);
    assert.equal(savedArgs.report.identity_class, 'anonymous');
    assert.equal(savedArgs.report.anonymous_device_id, 'fbd_abcdefghijkl');
    assert.equal(savedArgs.report.abuse_key_hash, 'crash-abuse-key');
    assert.equal(savedArgs.report.transcript, 'Crash report: TypeError: Boom');
    assert.equal(savedArgs.report.diagnostic_bundle.report_type, 'crash_report');
    assert.equal(savedArgs.report.diagnostic_bundle.crash_report.error.message, 'Boom');
    assert.deepEqual(savedArgs.report.diagnostic_bundle.crash_report.recent_request_ids, ['req_abcdefghijkl']);
  });

  test('rejects crash reports without a signature and message', async () => {
    const app = await buildApp({ optionalAuth: async () => null });

    const res = await app.inject({
      method: 'POST',
      url: '/api/crash-reports',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ crash_report: { error: {} } }),
    });

    assert.equal(res.statusCode, 400);
  });
});
