import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  checkAnonymousFeedbackRateLimit,
  hashFeedbackAbuseKey,
  resetFeedbackRateLimitsForTests,
} from './feedbackRateLimit.js';

describe('feedback rate limiting', () => {
  test('derives stable abuse keys from request context without client identity', () => {
    const first = hashFeedbackAbuseKey({
      ip: '203.0.113.4',
      userAgent: 'Chrome',
      routeType: 'feedback',
      buildId: 'abc123',
    });
    const second = hashFeedbackAbuseKey({
      ip: '203.0.113.4',
      userAgent: 'Chrome',
      routeType: 'feedback',
      buildId: 'abc123',
    });

    assert.equal(first, second);
    assert.equal(first.length, 64);
    assert.equal(first.includes('203.0.113.4'), false);
    assert.equal(first.includes('Chrome'), false);
  });

  test('rejects anonymous reports over the server-side limit', () => {
    resetFeedbackRateLimitsForTests();
    const request = {
      ip: '203.0.113.4',
      headers: { 'user-agent': 'Chrome' },
    };

    let result;
    for (let i = 0; i < 9; i += 1) {
      result = checkAnonymousFeedbackRateLimit(request, {
        now: 1000,
        diagnosticBundle: { build_id: 'abc123', route: { screen: 'feedback' } },
      });
    }

    assert.equal(result.allowed, false);
    assert.equal(result.abuseKeyHash.length, 64);
  });

  test('allows a higher server guard for data-loss reports', () => {
    resetFeedbackRateLimitsForTests();
    const request = {
      ip: '203.0.113.4',
      headers: { 'user-agent': 'Chrome' },
    };

    let result;
    for (let i = 0; i < 9; i += 1) {
      result = checkAnonymousFeedbackRateLimit(request, {
        now: 1000,
        dataLoss: true,
        diagnosticBundle: { build_id: 'abc123', route: { screen: 'feedback' } },
      });
    }

    assert.equal(result.allowed, true);
  });
});
