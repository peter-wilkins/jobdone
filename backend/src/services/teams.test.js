import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getMyWorkState, presentTeamInvite } from './teams.js';

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

test('Team Work state filters signed-in work to the selected Team', async () => {
  let backlogTeamFilter = null;
  const teams = [
    { id: 'team-1', name: 'Alpha', template: 'high_trust', points_enabled: false, approval_mode: 'auto', created_at: '2026-01-01T00:00:00Z' },
    { id: 'team-2', name: 'Beta', template: 'high_trust', points_enabled: false, approval_mode: 'auto', created_at: '2026-01-02T00:00:00Z' },
  ];
  const backlogRows = [
    { id: 'item-1', team_id: 'team-1', description: 'Alpha job', status: 'open', points: null, created_at: '2026-01-01T00:00:00Z' },
    { id: 'item-2', team_id: 'team-2', description: 'Beta job', status: 'open', points: null, created_at: '2026-01-02T00:00:00Z' },
  ];
  const db = {
    schema: 'jobdone',
    query: async () => ({ data: teams, error: null }),
    from: () => {
      const filters = [];
      const chain = {
        select: () => chain,
        in: (column, values) => {
          filters.push({ column, values });
          if (column === 'team_id') backlogTeamFilter = values;
          return chain;
        },
        eq: (column, value) => {
          filters.push({ column, values: [value] });
          return chain;
        },
        order: () => chain,
        then: (resolve, reject) => {
          const data = backlogRows.filter(row => filters.every(filter => filter.values.includes(row[filter.column])));
          return Promise.resolve({ data, error: null }).then(resolve, reject);
        },
      };
      return chain;
    },
  };

  const state = await getMyWorkState({ db, userEmail: 'worker@example.com', teamId: 'team-2' });

  assert.deepEqual(backlogTeamFilter, ['team-2']);
  assert.equal(state.team.id, 'team-2');
  assert.deepEqual(state.openBacklogItems.map(item => item.description), ['Beta job']);
});
