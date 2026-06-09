import assert from 'node:assert/strict';
import test from 'node:test';
import {
  canLoadTeamPageState,
  loadCachedTeamPageState,
  saveCachedTeamPageState,
  backlogItemContextSnapshot,
  searchTeamContext,
  selectPrivateTimelineEntries,
  selectTeamTimelineEntries,
  teamContextSnapshot,
} from './teamPageService.js';

function memoryStorage() {
  const values = new Map();
  return {
    getItem: key => values.has(key) ? values.get(key) : null,
    setItem: (key, value) => values.set(key, String(value)),
  };
}

test('Team Timeline selects entries linked to the current Team context', () => {
  const entries = [
    { id: 'entry-1', workContexts: [{ teamId: 'team-1', teamName: 'Foo' }] },
    { id: 'entry-2', workContexts: [{ team_id: 'team-2', teamName: 'Bar' }] },
    { id: 'entry-3', workContexts: [{ teamName: 'Foo' }] },
    { id: 'entry-4', workContexts: [] },
  ];

  assert.deepEqual(
    selectTeamTimelineEntries(entries, 'team-1', 'Foo').map(entry => entry.id),
    ['entry-1', 'entry-3'],
  );
});

test('Private Timeline excludes entries linked to Team work contexts', () => {
  const entries = [
    { id: 'private-entry', status: 'confirmed', text: 'Private boiler note', workContexts: [] },
    { id: 'team-entry', status: 'confirmed', text: 'Team boiler note', workContexts: [{ id: 'backlog-1', teamId: 'team-1' }] },
    { id: 'legacy-team-entry', status: 'confirmed', text: 'Legacy Team note', workContextIds: ['backlog-2'] },
  ];

  assert.deepEqual(
    selectPrivateTimelineEntries(entries).map(entry => entry.id),
    ['private-entry'],
  );
});

test('Team page waits for restored user before loading remote Team state', () => {
  assert.equal(canLoadTeamPageState({ teamId: 'team-1', user: null }), false);
  assert.equal(canLoadTeamPageState({ teamId: 'team-1', user: {} }), false);
  assert.equal(canLoadTeamPageState({ teamId: '', user: { id: 'user-1' } }), false);
  assert.equal(canLoadTeamPageState({ teamId: 'team-1', user: { id: 'user-1' } }), true);
});

test('Team context snapshots link general Team Entries to Team Timeline', () => {
  const snapshot = teamContextSnapshot({ id: 'team-1', name: 'Foo' });
  const entries = [
    { id: 'entry-1', workContexts: [snapshot] },
    { id: 'entry-2', workContexts: [] },
  ];

  assert.deepEqual(snapshot, {
    id: 'team:team-1',
    type: 'team',
    label: 'Foo',
    description: 'Foo',
    teamId: 'team-1',
    teamName: 'Foo',
    status: 'team',
  });
  assert.deepEqual(
    selectTeamTimelineEntries(entries, 'team-1', 'Foo').map(entry => entry.id),
    ['entry-1'],
  );
});

test('Backlog Item context snapshots link evidence to one item', () => {
  assert.deepEqual(
    backlogItemContextSnapshot({
      id: 'backlog-1',
      description: 'Study farm pond sites',
      team: { id: 'team-1', name: 'Farm' },
      status: 'claimed',
    }),
    {
      id: 'backlog-1',
      type: 'backlog_item',
      label: 'Study farm pond sites',
      description: 'Study farm pond sites',
      teamId: 'team-1',
      teamName: 'Farm',
      status: 'claimed',
    },
  );
});

test('Team page cache restores last read model for instant render', () => {
  const storage = memoryStorage();
  saveCachedTeamPageState('team-1', {
    team: { id: 'team-1', name: 'Farm' },
    openBacklogItems: [{ id: 'backlog-1' }],
  }, { storage });

  const cached = loadCachedTeamPageState('team-1', { storage });

  assert.equal(cached.team.name, 'Farm');
  assert.deepEqual(cached.openBacklogItems, [{ id: 'backlog-1' }]);
  assert.equal(typeof cached.cachedAt, 'string');
});

test('Team search returns scoped Backlog and Entry groups', () => {
  const result = searchTeamContext({
    query: 'pond survey',
    team: { id: 'team-1', name: 'Garden Team' },
    openBacklogItems: [
      { id: 'backlog-1', description: 'Study farm for potential pond survey sites', status: 'open' },
      { id: 'backlog-2', description: 'Clean van', status: 'open' },
    ],
    entries: [
      {
        id: 'entry-1',
        status: 'confirmed',
        text: 'Finished pond survey photos',
        workContexts: [{ id: 'backlog-1', teamId: 'team-1', teamName: 'Garden Team' }],
      },
      {
        id: 'entry-2',
        status: 'confirmed',
        text: 'Other team pond survey',
        workContexts: [{ id: 'backlog-3', teamId: 'team-2', teamName: 'Other Team' }],
      },
      {
        id: 'entry-3',
        status: 'confirmed',
        text: 'Private pond survey',
        workContexts: [],
      },
    ],
  });

  assert.deepEqual(result.backlogItems.map(item => item.id), ['backlog-1']);
  assert.deepEqual(result.entries.map(entry => entry.id), ['entry-1']);
  assert.equal(result.hasResults, true);
});
