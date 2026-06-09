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
      email: 'owner@example.com',
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

async function routeSync(page) {
  await page.route('**/api/sync/**', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ success: true, entries: [], contacts: [], locations: [] }),
  }));
}

test('Create Team page updates burger Team links after create without reload', async ({ page }) => {
  await installAuth(page);
  await routeSync(page);

  let createdTeam = null;
  await page.route('**/api/teams/setup**', async route => {
    if (route.request().method() === 'PATCH') {
      const payload = route.request().postDataJSON();
      createdTeam = {
        id: 'team-new',
        name: payload.name.trim(),
        template: payload.template,
        points_enabled: false,
        approval_mode: 'auto',
        created_at: '2026-06-09T06:30:00Z',
      };
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ team: createdTeam }),
      });
    }

    const requestUrl = new URL(route.request().url());
    const ownedTeams = createdTeam ? [createdTeam] : [];
    const selectedTeam = requestUrl.searchParams.get('team_id') === 'team-new' ? createdTeam : null;
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        team: selectedTeam,
        ownedTeams,
        memberTeams: [],
        teamMembers: [],
        canManage: true,
        inviteAccess: { canCreate: Boolean(selectedTeam) },
        pendingTeamInvites: [],
        openBacklogItems: [],
        submittedApprovalRequests: [],
      }),
    });
  });
  await page.route('**/api/teams/work?*', async route => {
    const requestUrl = new URL(route.request().url());
    expect(requestUrl.searchParams.get('team_id')).toBe('team-new');
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        team: createdTeam,
        teams: createdTeam ? [createdTeam] : [],
        inProgressItems: [],
        openBacklogItems: [],
        approvedItems: [],
        teamAccess: { canCreateBacklogItems: true, canEditTeam: true },
      }),
    });
  });
  await page.route('**/api/teams/review', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({
      ownedTeams: createdTeam ? [createdTeam] : [],
      canManage: true,
      activeApprovalRequests: [],
      recentDecisions: [],
    }),
  }));

  await page.goto('/#team-setup');

  await page.getByTitle('Menu').click();
  await expect(page.getByRole('button', { name: 'Create Team' }).first()).toBeVisible();
  await expect(page.getByRole('button', { name: 'Edit Teams' })).toHaveCount(0);
  await page.getByTitle('Menu').click();

  await expect(page.locator('h1', { hasText: 'Create Team' })).toBeVisible();
  await page.getByPlaceholder('Team name, e.g. Chawmore').fill('Garden Crew');
  await page.getByRole('main').getByRole('button', { name: 'Create Team' }).click();
  await expect(page).toHaveURL(/#team\/team-new$/);
  await expect(page.getByRole('heading', { name: 'Garden Crew' })).toBeVisible();

  await page.getByTitle('Menu').click();
  await expect(page.getByRole('button', { name: 'Garden Crew' })).toBeVisible();
  await page.getByTitle('Menu').click();

  await page.getByRole('button', { name: 'Edit' }).click();
  await expect(page.locator('h1', { hasText: 'Edit Team' })).toBeVisible();
  await page.getByTitle('Back').click();
  await expect(page).toHaveURL(/#team\/team-new$/);
  await expect(page.getByRole('heading', { name: 'Garden Crew' })).toBeVisible();
});
