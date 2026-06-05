import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseContactPullPayload,
  parseContactsPayload,
  parseLocationsPayload,
} from '../contracts/syncRequests.js';

describe('Sync request contracts', () => {
  test('accepts canonical Contact, Contact pull, and Location sync payloads', () => {
    assert.equal(parseContactsPayload({
      contacts: [{
        id: 'contact-local-1',
        localId: 'contact-local-1',
        clientId: 'contact-local-1',
        status: 'confirmed',
        displayName: 'Ann Smith',
        phones: [{ value: '+353123', normalized: '+353123' }],
        emails: [],
        normalizedPhones: ['+353123'],
        normalizedEmails: [],
        sourceCaptureIds: [],
        contentHash: 'hash-a',
        identityKeys: ['phone:+353123'],
        createdAt: '2026-05-17T01:00:00.000Z',
        updatedAt: '2026-05-17T01:01:00.000Z',
      }],
    }).success, true);

    assert.equal(parseContactPullPayload({ clientIds: ['contact-local-1'] }).success, true);

    assert.equal(parseLocationsPayload({
      locations: [{
        id: 'location-local-1',
        localId: 'location-local-1',
        remoteId: null,
        status: 'confirmed',
        displayName: '14 Bell Street',
        placeText: '14 Bell Street',
        addressText: '',
        latitude: 53.3498,
        longitude: -6.2603,
        createdAt: '2026-05-17T01:00:00.000Z',
        updatedAt: '2026-05-17T01:01:00.000Z',
      }],
    }).success, true);
  });

  test('rejects old snake-case Contact and Location request fields', () => {
    assert.equal(parseContactsPayload({
      contacts: [{ displayName: 'Ann Smith', created_at: '2026-05-17T01:00:00.000Z' }],
    }).error, 'Use contacts.0.createdAt, not contacts.0.created_at');

    assert.equal(parseLocationsPayload({
      locations: [{ displayName: '14 Bell Street', display_name: '14 Bell Street' }],
    }).error, 'Use locations.0.displayName, not locations.0.display_name');
  });
});
