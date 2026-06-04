import assert from 'node:assert/strict';
import test from 'node:test';
import { mergeEntryUpdates } from './dbService.js';

test('confirmed Entry cannot be downgraded to review by draft updates', () => {
  const entry = {
    id: 'entry-1',
    status: 'confirmed',
    summary: 'Confirmed text',
    transcript: 'Confirmed transcript',
    attachmentSnapshots: [{ id: 'photo-1', kind: 'photo', status: 'ready' }],
  };

  const updated = mergeEntryUpdates(entry, {
    status: 'ready_for_review',
    summary: 'Draft text',
    transcript: 'Draft transcript',
    attachmentSnapshots: [],
  });

  assert.equal(updated.status, 'confirmed');
  assert.equal(updated.summary, 'Confirmed text');
  assert.equal(updated.transcript, 'Confirmed transcript');
  assert.deepEqual(updated.attachmentSnapshots, [{ id: 'photo-1', kind: 'photo', status: 'ready' }]);
});

test('confirmed Entry can still record sync metadata', () => {
  const entry = { id: 'entry-1', status: 'confirmed', syncStatus: 'pending' };

  const updated = mergeEntryUpdates(entry, {
    syncStatus: 'synced',
    remoteId: 'server-entry-1',
  });

  assert.equal(updated.status, 'confirmed');
  assert.equal(updated.syncStatus, 'synced');
  assert.equal(updated.remoteId, 'server-entry-1');
});
