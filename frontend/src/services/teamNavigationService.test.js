import assert from 'node:assert/strict';
import test from 'node:test';
import {
  clearCachedReadableTeams,
  loadCachedReadableTeams,
  mergeReadableTeams,
  saveCachedReadableTeams,
  shouldHoldTeamScreenForAuth,
  teamIdFromScreen,
  teamScreenId,
} from './teamNavigationService.js';

function memoryStorage() {
  const values = new Map();
  return {
    getItem: key => values.has(key) ? values.get(key) : null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: key => values.delete(key),
  };
}

test('Team navigation encodes readable Team links', () => {
  const teamId = 'team/slash and space';
  assert.equal(teamScreenId(teamId), 'team/team%2Fslash%20and%20space');
  assert.equal(teamIdFromScreen('team/team%2Fslash%20and%20space'), teamId);
  assert.equal(teamIdFromScreen('my-work'), null);
});

test('Team route waits for auth restore before showing logged-out UI', () => {
  assert.equal(shouldHoldTeamScreenForAuth({
    screen: teamScreenId('team-1'),
    authReady: false,
    user: null,
    cachedUser: null,
  }), true);
  assert.equal(shouldHoldTeamScreenForAuth({
    screen: teamScreenId('team-1'),
    authReady: true,
    user: null,
    cachedUser: null,
  }), false);
  assert.equal(shouldHoldTeamScreenForAuth({
    screen: teamScreenId('team-1'),
    authReady: false,
    user: { id: 'user-1' },
    cachedUser: null,
  }), false);
  assert.equal(shouldHoldTeamScreenForAuth({
    screen: 'home',
    authReady: false,
    user: null,
    cachedUser: null,
  }), false);
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

test('Team menu cache restores stable readable Teams before live refresh', () => {
  const storage = memoryStorage();
  saveCachedReadableTeams([
    { id: 'team-2', name: 'Worker Team', created_at: '2026-01-02T00:00:00Z' },
    { id: 'team-1', name: 'Owner Team', created_at: '2026-01-01T00:00:00Z' },
  ], { storage });

  assert.deepEqual(loadCachedReadableTeams({ storage }).map(team => team.id), ['team-1', 'team-2']);
});

test('Team menu cache can be cleared after confirmed sign out', () => {
  const storage = memoryStorage();
  saveCachedReadableTeams([{ id: 'team-1', name: 'Owner Team' }], { storage });

  assert.deepEqual(loadCachedReadableTeams({ storage }).map(team => team.id), ['team-1']);

  clearCachedReadableTeams({ storage });

  assert.deepEqual(loadCachedReadableTeams({ storage }), []);
});
