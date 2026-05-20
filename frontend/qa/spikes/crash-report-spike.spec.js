import { expect, test } from '@playwright/test';
import { enableDebugLogs, expectDebugLog } from '../helpers/debugLogs.js';

const CRASH_STORAGE_KEY = 'jobdone-crash-reports';

test('crash report spike: pending crash auto-sends and shows status bar', async ({ page }) => {
  const debugLogs = await enableDebugLogs(page);
  const capturedRequests = [];

  await page.route('**/api/crash-reports', async route => {
    const request = route.request();
    capturedRequests.push(request.postDataJSON());
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        crash_report: {
          id: 'crash-feedback-1',
        },
      }),
    });
  });

  await page.addInitScript(({ key }) => {
    window.localStorage.setItem(key, JSON.stringify([
      {
        crash_id: 'crash_spike_1',
        signature: 'spike-signature',
        captured_at: '2026-05-20T12:00:00.000Z',
        source: 'window_error',
        build_id: 'playwright-spike',
        route: { path: '/', hash: '', screen: 'home' },
        error: {
          name: 'TypeError',
          message: 'Playwright crash spike',
          stack: 'TypeError: Playwright crash spike\\n    at spike.js:1:1',
        },
        recent_request_ids: ['req_spike123456'],
      },
    ]));
  }, { key: CRASH_STORAGE_KEY });

  await page.goto('/');

  await expect(page.getByText('1 crash report sent automatically.')).toBeVisible({ timeout: 15000 });
  await expect.poll(() => capturedRequests.length).toBe(1);

  const body = capturedRequests[0];
  expect(body.crash_report.error.message).toBe('Playwright crash spike');
  expect(body.crash_report.recent_request_ids).toEqual(['req_spike123456']);
  expect(body.diagnostic_bundle.report_type).toBe('crash_report');
  expect(body.diagnostic_bundle.privacy.excludes).toContain('auth/session data');
  expect(body.diagnostic_bundle.privacy.excludes).toContain('IndexedDB dumps');
  await expectDebugLog(debugLogs, /diagnostic_event screen_open/);
  await expectDebugLog(debugLogs, /api_request .*\/api\/crash-reports/);
});
