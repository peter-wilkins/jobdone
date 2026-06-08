import assert from 'node:assert/strict';
import test from 'node:test';
import { selectTeamTimelineEntries } from './teamPageService.js';

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

