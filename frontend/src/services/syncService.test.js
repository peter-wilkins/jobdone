import { test } from 'node:test';
import assert from 'node:assert/strict';
import { apiService } from './apiService.js';
import { authService } from './authService.js';
import { dbService } from './dbService.js';
import { syncService } from './syncService.js';

test('syncEntry sends canonical entryData fields to the API', async () => {
  const originals = {
    isLoggedIn: authService.isLoggedIn,
    getContextCluesForEntry: dbService.getContextCluesForEntry,
    getLocationsForEntry: dbService.getLocationsForEntry,
    getTagsForEntry: dbService.getTagsForEntry,
    syncSave: apiService.syncSave,
  };
  let payload;

  try {
    authService.isLoggedIn = () => true;
    dbService.getContextCluesForEntry = async () => [{ kind: 'manual', summary: 'Evidence' }];
    dbService.getLocationsForEntry = async () => [{ id: '01973e36-4c80-7abc-8a72-111111111111', displayName: '14 Bell Street' }];
    dbService.getTagsForEntry = async () => [];
    apiService.syncSave = async (nextPayload) => {
      payload = nextPayload;
      return { success: true, entry: { id: 'entry-cloud-1' } };
    };

    await syncService.syncEntry({
      id: 'entry-local-1',
      transcript: 'Fixed a dripping kitchen tap.',
      summary: 'Fixed dripping kitchen tap.',
      createdAt: '2026-05-17T01:00:00.000Z',
      locations: [{ id: 'legacy-location-1', displayName: 'Stale Bell Street snapshot' }],
      contacts: [{ id: 'contact-local-1', displayName: 'Ann Smith' }],
      tags: [{ id: 'tag-local-1', label: 'Boiler Service' }],
      attachments: [],
    });

    assert.equal(payload.entryData.id, 'entry-local-1');
    assert.equal(payload.entryData.createdAt, '2026-05-17T01:00:00.000Z');
    assert.equal(payload.entryData.captureId, null);
    assert.deepEqual(payload.entryData.locations, [{ id: '01973e36-4c80-7abc-8a72-111111111111', displayName: '14 Bell Street' }]);
    assert.deepEqual(payload.entryData.contacts, [{ id: 'contact-local-1', displayName: 'Ann Smith' }]);
    assert.deepEqual(payload.entryData.tags, [{ id: 'tag-local-1', label: 'Boiler Service' }]);
    assert.equal(Object.prototype.hasOwnProperty.call(payload.entryData, 'created_at'), false);
    assert.equal(Object.prototype.hasOwnProperty.call(payload.entryData, 'capture_id'), false);
    assert.equal(Object.prototype.hasOwnProperty.call(payload.entryData, 'locationSnapshots'), false);
    assert.equal(Object.prototype.hasOwnProperty.call(payload.entryData, 'contactSnapshots'), false);
    assert.equal(Object.prototype.hasOwnProperty.call(payload.entryData, 'tagSnapshots'), false);
    assert.equal(Object.prototype.hasOwnProperty.call(payload.entryData, 'attachmentSnapshots'), false);
  } finally {
    authService.isLoggedIn = originals.isLoggedIn;
    dbService.getContextCluesForEntry = originals.getContextCluesForEntry;
    dbService.getLocationsForEntry = originals.getLocationsForEntry;
    dbService.getTagsForEntry = originals.getTagsForEntry;
    apiService.syncSave = originals.syncSave;
  }
});
