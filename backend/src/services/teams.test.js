import { test } from 'node:test';
import assert from 'node:assert/strict';
import { presentTeamInvite } from './teams.js';

test('team invite default URL uses canonical production app', () => {
  const previousFrontendUrl = process.env.FRONTEND_URL;
  const previousViteAppUrl = process.env.VITE_APP_URL;
  delete process.env.FRONTEND_URL;
  delete process.env.VITE_APP_URL;

  try {
    const invite = presentTeamInvite({
      id: '00000000-0000-4000-8000-000000000123',
      team_id: 'team-1',
      email: 'worker@example.com',
      status: 'pending',
    });

    assert.equal(invite.invite_url.startsWith('https://jobdone.continuumkit.org/invite?token='), true);
  } finally {
    if (previousFrontendUrl === undefined) delete process.env.FRONTEND_URL;
    else process.env.FRONTEND_URL = previousFrontendUrl;
    if (previousViteAppUrl === undefined) delete process.env.VITE_APP_URL;
    else process.env.VITE_APP_URL = previousViteAppUrl;
  }
});
