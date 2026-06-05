import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseContactsResponse,
  parseEntriesResponse,
  parseEntrySaveResponse,
  parseLocationsResponse,
} from '../contracts/syncResponses.js';

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
          id: 'location-local-1',
          remoteId: 'location-cloud-1',
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

    assert.equal(parseLocationsResponse({
      success: true,
      locations: [{
        id: 'location-local-1',
        remoteId: 'location-cloud-1',
        status: 'confirmed',
        displayName: '14 Bell Street',
        placeText: '14 Bell Street',
        addressText: '',
        latitude: 53.3498,
        longitude: -6.2603,
        providerPlaceId: null,
        createdAt: null,
        updatedAt: null,
      }],
    }).success, true);
  });

  test('rejects old snake-case sync response fields', () => {
    assert.equal(parseLocationsResponse({
      success: true,
      locations: [{
        id: 'location-cloud-1',
        display_name: '14 Bell Street',
      }],
    }).success, false);

    assert.equal(parseContactsResponse({
      success: true,
      contacts: [{
        id: 'contact-cloud-1',
        display_name: 'Ann Smith',
      }],
    }).success, false);
  });
});
