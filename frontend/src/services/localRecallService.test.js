import assert from 'node:assert/strict';
import test from 'node:test';
import { recallLocalEntries } from './localRecallService.js';

test('local recall searches confirmed local entries without backend auth', () => {
  const results = recallLocalEntries('tap repair', [
    {
      id: 'entry-1',
      status: 'confirmed',
      summary: 'Repaired leaking tap in kitchen',
      createdAt: '2026-06-05T10:00:00.000Z',
      syncStatus: 'pending',
    },
    {
      id: 'entry-2',
      status: 'ready_for_review',
      summary: 'Draft tap note',
      createdAt: '2026-06-05T11:00:00.000Z',
    },
  ]);

  assert.deepEqual(results.map(entry => entry.id), ['entry-1']);
  assert.equal(results[0].syncStatus, 'pending');
});

test('local recall searches local context clues', () => {
  const results = recallLocalEntries('bell alan boiler', [
    {
      id: 'entry-1',
      status: 'confirmed',
      summary: 'Annual service complete',
      createdAt: '2026-06-05T10:00:00.000Z',
      locations: [{ displayName: '14 Bell Street' }],
      contacts: [{ displayName: 'Alan Smith' }],
      tags: [{ label: 'Boiler Service' }],
    },
    {
      id: 'entry-2',
      status: 'confirmed',
      summary: 'Fence repair',
      createdAt: '2026-06-05T11:00:00.000Z',
    },
  ]);

  assert.deepEqual(results.map(entry => entry.id), ['entry-1']);
});

test('local recall ranks exact phrase before token overlap', () => {
  const results = recallLocalEntries('garden pond', [
    {
      id: 'entry-token-overlap',
      status: 'confirmed',
      summary: 'Garden path inspected and pond pump checked',
      createdAt: '2026-06-05T11:00:00.000Z',
    },
    {
      id: 'entry-exact',
      status: 'confirmed',
      summary: 'Visited garden pond site',
      createdAt: '2026-06-05T09:00:00.000Z',
    },
  ]);

  assert.deepEqual(results.map(entry => entry.id), ['entry-exact', 'entry-token-overlap']);
});
