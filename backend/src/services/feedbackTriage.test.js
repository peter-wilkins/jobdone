import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeFeedbackTriageRecord,
  prepareFeedbackIssueDraft,
  sortFeedbackTriageRecords,
} from './feedbackTriage.js';

function feedbackRow(overrides = {}) {
  return {
    id: 'feedback-1',
    user_id: null,
    identity_class: 'anonymous',
    anonymous_device_id: 'fbd_device_1',
    transcript: 'Login failed after install.',
    created_at: '2026-05-31T10:00:00.000Z',
    diagnostic_bundle: {
      build_id: 'build-1',
      route: { screen: 'login', path: '/', hash: '#login' },
      backend: { available: false },
      feedback: {
        kind: 'sync_login',
        impact: 'blocked',
        data_loss: 'unsure',
        surface: 'login',
      },
      recent_api_requests: [
        {
          request_id: 'req_abcdefghijkl',
          endpoint: '/api/sync/save',
          method: 'POST',
          status: 500,
          ok: false,
          failure_kind: 'http_error',
          at: '2026-05-31T09:59:00.000Z',
        },
      ],
      recent_events: [{ event: 'screen_open', detail: { screen: 'login' } }],
      privacy: { excludes: ['entry content', 'contact details'] },
    },
    ...overrides,
  };
}

describe('feedback triage normalization', () => {
  test('builds normalized factual records from feedback diagnostics', () => {
    const record = normalizeFeedbackTriageRecord(feedbackRow());

    assert.equal(record.report_type, 'feedback_report');
    assert.equal(record.kind, 'sync_login');
    assert.equal(record.impact, 'blocked');
    assert.equal(record.data_loss, 'unsure');
    assert.equal(record.priority, 'p1_blocked');
    assert.equal(record.build_id, 'build-1');
    assert.equal(record.surface, 'login');
    assert.deepEqual(record.recent_request_ids, ['req_abcdefghijkl']);
    assert.equal(record.backend_health.available, false);
    assert.equal(record.recent_errors[0].endpoint, '/api/sync/save');
    assert.equal(record.suggested_summary.label, 'suggested_not_authoritative');
    assert.ok(record.dedupe_signature);
  });

  test('prioritizes data-loss reports and crash reports', () => {
    const dataLoss = normalizeFeedbackTriageRecord(feedbackRow({
      id: 'data-loss',
      diagnostic_bundle: {
        feedback: { kind: 'data_loss', impact: 'degraded', data_loss: 'yes', surface: 'timeline' },
      },
      created_at: '2026-05-31T08:00:00.000Z',
    }));
    const crash = normalizeFeedbackTriageRecord(feedbackRow({
      id: 'crash',
      transcript: 'Crash report: TypeError: Boom',
      diagnostic_bundle: {
        report_type: 'crash_report',
        crash_report: {
          signature: 'TypeError:boom:home',
          build_id: 'build-2',
          route: { screen: 'home' },
          error: { name: 'TypeError', message: 'Boom' },
          recent_request_ids: ['req_crash123456'],
        },
      },
      created_at: '2026-05-31T09:00:00.000Z',
    }));
    const normal = normalizeFeedbackTriageRecord(feedbackRow({ id: 'normal' }));

    assert.equal(dataLoss.priority, 'p0_data_loss');
    assert.equal(crash.priority, 'p1_crash');
    assert.deepEqual(sortFeedbackTriageRecords([normal, crash, dataLoss]).map(record => record.id), [
      'data-loss',
      'normal',
      'crash',
    ]);
  });

  test('uses deterministic dedupe signatures', () => {
    const first = normalizeFeedbackTriageRecord(feedbackRow({ id: 'feedback-a' }));
    const second = normalizeFeedbackTriageRecord(feedbackRow({ id: 'feedback-b' }));

    assert.equal(first.dedupe_signature, second.dedupe_signature);
  });

  test('prepares an issue draft without raw diagnostic bundle dumps', () => {
    const record = normalizeFeedbackTriageRecord(feedbackRow());
    const draft = prepareFeedbackIssueDraft(record);

    assert.match(draft.title, /Feedback: login/);
    assert.match(draft.body, /Suggested, not authoritative/);
    assert.match(draft.body, /req_abcdefghijkl/);
    assert.doesNotMatch(draft.body, /raw_diagnostic_bundle/);
    assert.doesNotMatch(draft.body, /userAgent/);
  });
});
