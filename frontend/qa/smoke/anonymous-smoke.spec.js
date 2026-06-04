import { expect, test } from '@playwright/test';
import { enableDebugLogs, expectDebugLog } from '../helpers/debugLogs.js';
/* global process */

const BLOCKING_ERROR_TEXT = [
  'Auth not configured',
  'Invalid schema: jobdone',
  'Postgres not configured',
  'Internal server error',
];

async function expectNoKnownBlockingErrors(page) {
  for (const text of BLOCKING_ERROR_TEXT) {
    await expect(page.getByText(text)).toHaveCount(0);
  }
}

test('anonymous app shell loads without known blocking errors', async ({ page }) => {
  const debugLogs = await enableDebugLogs(page);

  await page.goto('/');
  await expect(page.getByRole('button', { name: /start entry/i })).toBeVisible();
  await expectNoKnownBlockingErrors(page);
  await expectDebugLog(debugLogs, /diagnostic_event screen_open/);
});

test('anonymous feedback report can be sent', async ({ page }) => {
  const debugLogs = await enableDebugLogs(page);

  if (!process.env.QA_BASE_URL) {
    await page.route('**/api/feedback/save', async route => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          feedback: { id: 'playwright-feedback-1' },
        }),
      });
    });
  }

  await page.goto('/#feedback');
  await expect(page.getByRole('heading', { name: /share idea/i })).toBeVisible();

  await page.getByPlaceholder(/what would make jobdone better/i).fill(`Playwright smoke feedback ${Date.now()}`);
  await page.getByRole('button', { name: /^send idea$/i }).click();

  await expect(page.getByText('Report sent.')).toBeVisible({ timeout: 15000 });
  await expectNoKnownBlockingErrors(page);
  await expectDebugLog(debugLogs, /diagnostic_event report_issue_opened/);
  await expectDebugLog(debugLogs, /diagnostic_event issue_report_typed_created/);
  await expectDebugLog(debugLogs, /api_request .*\/api\/feedback\/save/);
});
