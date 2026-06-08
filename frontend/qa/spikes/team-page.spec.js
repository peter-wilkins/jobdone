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

async function installAuth(page) {
  await page.addInitScript(({ key, session }) => {
    window.localStorage.setItem(key, JSON.stringify(session));
  }, { key: AUTH_STORAGE_KEY, session: authSession() });
}

async function routeTeamSetup(page) {
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
}

async function routeReview(page, requests = []) {
  await page.route('**/api/teams/review', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({
      ownedTeams: [{ id: 'team-2', name: 'Foo Team' }],
      canManage: true,
      activeApprovalRequests: requests,
      recentDecisions: [],
    }),
  }));
}

async function routeSync(page) {
  await page.route('**/api/sync/**', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ success: true, entries: [], contacts: [], locations: [] }),
  }));
}

test('Team page opens scoped work for selected Team', async ({ page }) => {
  await installAuth(page);
  await routeTeamSetup(page);

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
        teamAccess: { canCreateBacklogItems: false },
      }),
    });
  });

  await routeReview(page, [
    {
      id: 'approval-1',
      team_id: 'team-2',
      status: 'submitted',
      evidence_text: 'Photos added.',
      backlog_item: { id: 'done-1', description: 'Repair fence' },
    },
  ]);
  await routeSync(page);

  await page.goto('/#team/team-2');

  await expect(page.getByText('Team Context')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Foo Team' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Open Backlog' })).toBeVisible();
  await expect(page.getByText('Study pond sites')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Needs Review' })).toBeVisible();
  await expect(page.getByText('Repair fence')).toBeVisible();
});

test('Team page lets permitted users add a Backlog Item inline', async ({ page }) => {
  await installAuth(page);
  await routeTeamSetup(page);
  await routeReview(page);
  await routeSync(page);

  const openItems = [];
  await page.route('**/api/teams/work?*', route => {
    const requestUrl = new URL(route.request().url());
    expect(requestUrl.searchParams.get('team_id')).toBe('team-2');
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        team: { id: 'team-2', name: 'Foo Team', points_enabled: true, approval_mode: 'manual' },
        teams: [{ id: 'team-2', name: 'Foo Team' }],
        inProgressItems: [],
        openBacklogItems: openItems,
        approvedItems: [],
        teamAccess: { canCreateBacklogItems: true },
      }),
    });
  });
  await page.route('**/api/teams/backlog-items', async route => {
    const payload = route.request().postDataJSON();
    expect(payload.team_id).toBe('team-2');
    expect(payload.points).toBe(4);
    const backlogItem = {
      id: 'new-item-1',
      team_id: 'team-2',
      description: payload.description.trim(),
      points: payload.points,
      status: 'open',
      team: { id: 'team-2', name: 'Foo Team' },
    };
    openItems.push(backlogItem);
    return route.fulfill({
      status: 201,
      contentType: 'application/json',
      body: JSON.stringify({ backlogItem }),
    });
  });

  await page.goto('/#team/team-2');

  await page.getByRole('button', { name: 'Add Backlog Item' }).click();
  const backlogTextarea = page.getByPlaceholder('What should Foo Team do?');
  await expect(backlogTextarea).toBeVisible();
  await backlogTextarea.fill('Inspect pond liner');
  await page.getByLabel('Points').selectOption('4');
  await page.getByRole('button', { name: 'Add', exact: true }).click();

  await expect(page.getByText('Inspect pond liner')).toBeVisible();
  await expect(backlogTextarea).toHaveCount(0);
});

test('Team page hides Backlog add action without permission', async ({ page }) => {
  await installAuth(page);
  await routeTeamSetup(page);
  await routeReview(page);
  await routeSync(page);

  await page.route('**/api/teams/work?*', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({
      team: { id: 'team-2', name: 'Foo Team', points_enabled: false, approval_mode: 'manual' },
      teams: [{ id: 'team-2', name: 'Foo Team' }],
      inProgressItems: [],
      openBacklogItems: [],
      approvedItems: [],
      teamAccess: { canCreateBacklogItems: false },
    }),
  }));

  await page.goto('/#team/team-2');

  await expect(page.getByRole('heading', { name: 'Open Backlog' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Add Backlog Item' })).toHaveCount(0);
});
