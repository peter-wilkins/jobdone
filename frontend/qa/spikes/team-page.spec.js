import { expect, test } from '@playwright/test';

const AUTH_STORAGE_KEY = 'sb-dtwuflwgcwxygjgkvzfl-auth-token';

function authSession() {
  return {
    access_token: 'playwright-access-token',
    refresh_token: 'playwright-refresh-token',
    token_type: 'bearer',
    expires_at: Math.floor(Date.now() / 1000) + 3600,
    expires_in: 3600,
    user: {
      id: 'playwright-user',
      email: 'worker@example.com',
      role: 'authenticated',
      aud: 'authenticated',
    },
  };
}

test('Team page opens scoped work for selected Team', async ({ page }) => {
  await page.addInitScript(({ key, session }) => {
    window.localStorage.setItem(key, JSON.stringify(session));
  }, { key: AUTH_STORAGE_KEY, session: authSession() });

  await page.route('**/api/teams/setup', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({
      team: { id: 'team-2', name: 'Foo Team' },
      ownedTeams: [],
      memberTeams: [{ role: 'worker', team: { id: 'team-2', name: 'Foo Team', created_at: '2026-01-01T00:00:00Z' } }],
      teamMembers: [],
      canManage: false,
      inviteAccess: { canCreate: false },
      pendingTeamInvites: [],
      openBacklogItems: [],
      submittedApprovalRequests: [],
    }),
  }));

  await page.route('**/api/teams/work?*', route => {
    const requestUrl = new URL(route.request().url());
    expect(requestUrl.searchParams.get('team_id')).toBe('team-2');
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        team: { id: 'team-2', name: 'Foo Team', points_enabled: false, approval_mode: 'manual' },
        teams: [{ id: 'team-2', name: 'Foo Team' }],
        inProgressItems: [],
        openBacklogItems: [
          { id: 'open-1', team_id: 'team-2', description: 'Study pond sites', status: 'open', team: { id: 'team-2', name: 'Foo Team' } },
        ],
        approvedItems: [],
      }),
    });
  });

  await page.route('**/api/teams/review', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({
      ownedTeams: [{ id: 'team-2', name: 'Foo Team' }],
      canManage: true,
      activeApprovalRequests: [
        {
          id: 'approval-1',
          team_id: 'team-2',
          status: 'submitted',
          evidence_text: 'Photos added.',
          backlog_item: { id: 'done-1', description: 'Repair fence' },
        },
      ],
      recentDecisions: [],
    }),
  }));

  await page.route('**/api/sync/**', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ success: true, entries: [], contacts: [], locations: [] }),
  }));

  await page.goto('/#team/team-2');

  await expect(page.getByText('Team Context')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Foo Team' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Open Backlog' })).toBeVisible();
  await expect(page.getByText('Study pond sites')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Needs Review' })).toBeVisible();
  await expect(page.getByText('Repair fence')).toBeVisible();
});

