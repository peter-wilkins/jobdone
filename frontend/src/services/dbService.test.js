import assert from 'node:assert/strict';
import test from 'node:test';
import { isUuidV7 } from '../../../shared/contracts/clientId.js';
import { DBService, mergeEntryUpdates, normalizeEntryRecord } from './dbService.js';

test('new Entry IDs are UUIDv7 Client IDs for Local Replica sync', () => {
  const db = new DBService();
  const id = db.generateId();

  assert.equal(isUuidV7(id), true);
});

test('Entry records normalize legacy local fields to canonical app fields', () => {
  const normalized = normalizeEntryRecord({
    id: 'entry-1',
    created_at: '2026-05-17T01:00:00.000Z',
    synced_at: '2026-05-17T01:01:00.000Z',
    capture_id: 'capture-1',
    locationSnapshots: [{ id: 'location-1' }],
    contactSnapshots: [{ id: 'contact-1' }],
    tagSnapshots: [{ id: 'tag-1' }],
    attachmentSnapshots: [{ id: 'photo-1' }],
    workContextSnapshots: [{ id: 'backlog-1' }],
  });

  assert.equal(normalized.createdAt, '2026-05-17T01:00:00.000Z');
  assert.equal(normalized.syncedAt, '2026-05-17T01:01:00.000Z');
  assert.equal(normalized.captureId, 'capture-1');
  assert.deepEqual(normalized.locations, [{ id: 'location-1' }]);
  assert.deepEqual(normalized.contacts, [{ id: 'contact-1' }]);
  assert.deepEqual(normalized.tags, [{ id: 'tag-1' }]);
  assert.deepEqual(normalized.attachments, [{ id: 'photo-1' }]);
  assert.deepEqual(normalized.workContexts, [{ id: 'backlog-1' }]);
  assert.equal(Object.prototype.hasOwnProperty.call(normalized, 'created_at'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(normalized, 'locationSnapshots'), false);
});

test('confirmed Entry cannot be downgraded to review by draft updates', () => {
  const entry = {
    id: 'entry-1',
    status: 'confirmed',
    summary: 'Confirmed text',
    transcript: 'Confirmed transcript',
    attachments: [{ id: 'photo-1', kind: 'photo', status: 'ready' }],
  };

  const updated = mergeEntryUpdates(entry, {
    status: 'ready_for_review',
    summary: 'Draft text',
    transcript: 'Draft transcript',
    attachments: [],
  });

  assert.equal(updated.status, 'confirmed');
  assert.equal(updated.summary, 'Confirmed text');
  assert.equal(updated.transcript, 'Confirmed transcript');
  assert.deepEqual(updated.attachments, [{ id: 'photo-1', kind: 'photo', status: 'ready' }]);
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
