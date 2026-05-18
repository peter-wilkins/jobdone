import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import { registerFeedbackRoutes } from './feedback.js';

async function buildApp(deps = {}) {
  const app = Fastify({ logger: false });
  await registerFeedbackRoutes(app, {
    requireAuth: async () => ({ id: 'user-1' }),
    getFeedback: async () => [],
    saveFeedback: async (_userId, report) => ({ id: 'feedback-1', ...report }),
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
