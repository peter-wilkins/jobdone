import { expect, test } from '@playwright/test';

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
  await page.goto('/');
  await expect(page.getByRole('button', { name: /record/i })).toBeVisible();
  await expectNoKnownBlockingErrors(page);
});

test('anonymous feedback report can be sent', async ({ page }) => {
  await page.goto('/#feedback');
  await expect(page.getByRole('heading', { name: /report issue/i })).toBeVisible();

  await page.getByPlaceholder(/what went wrong/i).fill(`Playwright smoke feedback ${Date.now()}`);
  await page.getByRole('button', { name: /^send report$/i }).click();

  await expect(page.getByText('Report sent.')).toBeVisible({ timeout: 15000 });
  await expectNoKnownBlockingErrors(page);
});
