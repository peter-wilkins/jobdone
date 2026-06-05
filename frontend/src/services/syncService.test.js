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
    dbService.getLocationsForEntry = async () => [];
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
      locations: [{ id: 'location-local-1', displayName: '14 Bell Street' }],
      contacts: [{ id: 'contact-local-1', displayName: 'Ann Smith' }],
      tags: [{ id: 'tag-local-1', label: 'Boiler Service' }],
      attachments: [],
    });

    assert.equal(payload.entryData.id, 'entry-local-1');
    assert.equal(payload.entryData.createdAt, '2026-05-17T01:00:00.000Z');
    assert.equal(payload.entryData.captureId, null);
    assert.deepEqual(payload.entryData.locations, [{ id: 'location-local-1', displayName: '14 Bell Street' }]);
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

test('syncLocations sends canonical Location fields to the API', async () => {
  const originals = {
    isLoggedIn: authService.isLoggedIn,
    syncLocations: apiService.syncLocations,
  };
  let payload;

  try {
    authService.isLoggedIn = () => true;
    apiService.syncLocations = async (locations) => {
      payload = locations;
      return { success: true, locations: [] };
    };

    await syncService.syncLocations([{
      id: 'location-local-1',
      status: 'confirmed',
      displayName: '14 Bell Street',
      placeText: '14 Bell Street',
      addressText: '14 Bell Street, Dublin',
      latitude: 53.3498,
      longitude: -6.2603,
      remoteId: 'location-cloud-1',
      created_at: '2026-05-17T01:00:00.000Z',
      updated_at: '2026-05-17T01:01:00.000Z',
    }]);

    assert.deepEqual(payload, [{
      id: 'location-local-1',
      localId: 'location-local-1',
      status: 'confirmed',
      displayName: '14 Bell Street',
      placeText: '14 Bell Street',
      addressText: '14 Bell Street, Dublin',
      latitude: 53.3498,
      longitude: -6.2603,
      remoteId: 'location-cloud-1',
      providerPlaceId: undefined,
      createdAt: '2026-05-17T01:00:00.000Z',
      updatedAt: '2026-05-17T01:01:00.000Z',
    }]);
    assert.equal(Object.prototype.hasOwnProperty.call(payload[0], 'created_at'), false);
    assert.equal(Object.prototype.hasOwnProperty.call(payload[0], 'updated_at'), false);
  } finally {
    authService.isLoggedIn = originals.isLoggedIn;
    apiService.syncLocations = originals.syncLocations;
  }
});
