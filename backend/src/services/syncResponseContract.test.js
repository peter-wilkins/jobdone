import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseContactsResponse,
  parseEntriesResponse,
  parseEntrySaveResponse,
} from '../contracts/syncResponses.js';
import { parseLocationReplicaRecordsResponse } from '../contracts/locationReplica.js';

const LOCATION_ID = '01973e36-4c80-7abc-8a72-111111111111';

describe('Sync response contracts', () => {
  test('accepts canonical Entry, Contact, and Location sync responses', () => {
    assert.equal(parseEntrySaveResponse({
      success: true,
      entry: {
        id: 'entry-cloud-1',
        captureId: 'capture-1',
        transcript: 'Fixed tap',
        summary: 'Fixed tap.',
        createdAt: '2026-05-17T01:00:00.000Z',
        syncedAt: null,
        contextClues: [],
        locations: [{
          id: LOCATION_ID,
          status: 'confirmed',
          displayName: '14 Bell Street',
          placeText: '14 Bell Street',
          addressText: '',
          latitude: null,
          longitude: null,
          createdAt: null,
          updatedAt: null,
        }],
        contacts: [],
        tags: [],
        attachments: [],
      },
    }).success, true);

    assert.equal(parseEntriesResponse({ success: true, entries: [] }).success, true);

    assert.equal(parseContactsResponse({
      success: true,
      contacts: [{
        id: 'contact-cloud-1',
        serverId: 'contact-cloud-1',
        clientId: 'contact-local-1',
        status: 'confirmed',
        displayName: 'Ann Smith',
        givenName: '',
        familyName: '',
        organization: '',
        title: '',
        note: '',
        phones: [],
        emails: [],
        normalizedPhones: [],
        normalizedEmails: [],
        primaryPhone: null,
        primaryEmail: null,
        sourceCaptureIds: [],
        contentHash: null,
        identityKeys: [],
        createdAt: null,
        updatedAt: null,
      }],
      aliases: [],
    }).success, true);

    assert.equal(parseLocationReplicaRecordsResponse({
      success: true,
      locations: [{
        id: LOCATION_ID,
        status: 'active',
        displayName: '14 Bell Street',
        placeText: '14 Bell Street',
        addressText: '',
        latitude: 53.3498,
        longitude: -6.2603,
        providerPlaceId: null,
        contentHash: 'hash-a',
        createdAt: null,
        updatedAt: null,
      }],
      aliases: [],
    }).success, true);
  });

  test('rejects old snake-case sync response fields', () => {
    assert.equal(parseLocationReplicaRecordsResponse({
      success: true,
      locations: [{
        id: LOCATION_ID,
        status: 'active',
        display_name: '14 Bell Street',
      }],
      aliases: [],
    }).success, false);

    assert.equal(parseContactsResponse({
      success: true,
      contacts: [{
        id: 'contact-cloud-1',
        display_name: 'Ann Smith',
      }],
    }).success, false);
  });

  test('normalizes backend Date timestamps to canonical ISO strings', () => {
    const createdAt = new Date('2026-06-05T15:04:52.000Z');
    const syncedAt = new Date('2026-06-05T15:05:00.000Z');

    const entryResult = parseEntrySaveResponse({
      success: true,
      entry: {
        id: 'entry-cloud-1',
        captureId: null,
        transcript: 'Fixed tap',
        summary: 'Fixed tap.',
        createdAt,
        syncedAt,
        contextClues: [],
        locations: [{
          id: LOCATION_ID,
          status: 'confirmed',
          displayName: '14 Bell Street',
          placeText: '14 Bell Street',
          addressText: '',
          latitude: null,
          longitude: null,
          createdAt,
          updatedAt: syncedAt,
        }],
        contacts: [],
        tags: [],
        attachments: [],
      },
    });

    assert.equal(entryResult.success, true);
    assert.equal(entryResult.data.entry.createdAt, '2026-06-05T15:04:52.000Z');
    assert.equal(entryResult.data.entry.syncedAt, '2026-06-05T15:05:00.000Z');
    assert.equal(entryResult.data.entry.locations[0].createdAt, '2026-06-05T15:04:52.000Z');
    assert.equal(entryResult.data.entry.locations[0].updatedAt, '2026-06-05T15:05:00.000Z');
  });
});
