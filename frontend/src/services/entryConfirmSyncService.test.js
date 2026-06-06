import assert from 'node:assert/strict';
import { test } from 'node:test';
import { syncConfirmedEntryAfterReview } from './entryConfirmSyncService.js';

const entry = {
  id: 'entry-1',
  transcript: 'Fixed pond pump',
  summary: 'Fixed pond pump',
  syncStatus: 'pending',
};

test('confirmed Entry sync uses orchestrator so Local Replica flag owns routing', async () => {
  const calls = [];
  const result = await syncConfirmedEntryAfterReview({
    entryId: entry.id,
    entry,
    user: { id: 'user-1' },
    db: {
      getEntry: async (id) => {
        calls.push(['getEntry', id]);
        return { ...entry, syncStatus: 'synced' };
      },
    },
    syncOrchestrator: {
      syncConfirmedData: async ({ reason }) => {
        calls.push(['syncConfirmedData', reason]);
        return { ok: true, entries: { pushed: 1, pulled: 1 } };
      },
    },
    reason: 'entry_confirm',
  });

  assert.deepEqual(calls, [
    ['syncConfirmedData', 'entry_confirm'],
    ['getEntry', 'entry-1'],
  ]);
  assert.equal(result.skipped, false);
  assert.equal(result.entry.syncStatus, 'synced');
});

test('confirmed Entry sync skips cloud when user is not logged in', async () => {
  const calls = [];
  const originalLog = console.log;
  console.log = () => {};

  try {
    const result = await syncConfirmedEntryAfterReview({
      entry,
      user: null,
      syncOrchestrator: {
        syncConfirmedData: async () => {
          calls.push('syncConfirmedData');
        },
      },
    });

    assert.equal(result.skipped, true);
    assert.deepEqual(calls, []);
  } finally {
    console.log = originalLog;
  }
});
