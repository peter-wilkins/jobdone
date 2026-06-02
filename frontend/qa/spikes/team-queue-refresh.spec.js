import { expect, test } from '@playwright/test';

const initialWorkState = {
  team: { id: 'team-1', name: 'Dog Food Team', points_enabled: false, approval_mode: 'manual' },
  inProgressItems: [],
  openBacklogItems: [
    { id: 'item-1', team_id: 'team-1', description: 'Visible stale item', status: 'open', team: { name: 'Dog Food Team' } },
  ],
  approvedItems: [],
};

test('My Work refreshes on focus and keeps stale queue visible when refresh fails', async ({ page }) => {
  let requestCount = 0;
  let failRefresh = false;

  await page.route('**/api/my-work', route => {
    requestCount += 1;
    if (!failRefresh) {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(initialWorkState),
      });
    }
    return route.fulfill({
      status: 503,
      contentType: 'application/json',
      body: JSON.stringify({ error: 'Team queue unavailable' }),
    });
  });

  await page.goto('/#my-work');
  await expect(page.getByText('Visible stale item')).toBeVisible();

  failRefresh = true;
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));

  await expect(page.getByText('Visible stale item')).toBeVisible();
  await expect(page.getByText('My Work may be out of date.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Retry' })).toBeVisible();
  expect(requestCount).toBeGreaterThanOrEqual(2);
});
