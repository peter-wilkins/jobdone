import assert from 'node:assert/strict';
import test from 'node:test';
import { mergeReadableTeams, teamIdFromScreen, teamScreenId } from './teamNavigationService.js';

test('Team navigation encodes readable Team links', () => {
  const teamId = 'team/slash and space';
  assert.equal(teamScreenId(teamId), 'team/team%2Fslash%20and%20space');
  assert.equal(teamIdFromScreen('team/team%2Fslash%20and%20space'), teamId);
  assert.equal(teamIdFromScreen('my-work'), null);
});

test('Team menu merges owned and member Teams without duplicates', () => {
  const teams = mergeReadableTeams(
    [{ id: 'team-1', name: 'Owner Team', created_at: '2026-01-01T00:00:00Z' }],
    [
      { team: { id: 'team-1', name: 'Duplicate Team', created_at: '2026-01-01T00:00:00Z' }, role: 'worker' },
      { team: { id: 'team-2', name: 'Worker Team', created_at: '2026-01-02T00:00:00Z' }, role: 'worker' },
    ],
  );

  assert.deepEqual(teams.map(team => [team.id, team.relationship]), [
    ['team-1', 'owner'],
    ['team-2', 'worker'],
  ]);
});

