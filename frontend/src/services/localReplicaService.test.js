import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  contactContentHash,
  contactManifestRow,
  diffContactManifest,
  diffLocationManifest,
  locationContentHash,
  locationIdentityKeys,
  locationManifestRow,
  syncContactReplica,
  syncLocationReplica,
} from './localReplicaService.js';

const LOCATION_ID = '01973e36-4c80-7abc-8a72-111111111111';
const LOCATION_ID_2 = '01973e36-4c81-7abc-8a72-222222222222';

function contact(overrides = {}) {
  return {
    id: 'contact-local-1',
    status: 'confirmed',
    displayName: 'Ann Smith',
    phones: [{ value: '+353123', normalized: '+353123' }],
    emails: [],
    normalizedPhones: ['+353123'],
    normalizedEmails: [],
    ...overrides,
  };
}

function location(overrides = {}) {
  return {
    id: LOCATION_ID,
    status: 'active',
    displayName: '14 Bell Street',
    placeText: 'Workshop',
    addressText: '14 Bell Street, Testville',
    latitude: 51.5,
    longitude: -0.1,
    providerPlaceId: null,
    created_at: '2026-06-05T12:00:00.000Z',
    updated_at: '2026-06-05T12:01:00.000Z',
    ...overrides,
  };
}

test('contact content hash ignores volatile replica metadata', () => {
  const left = contact({ remoteId: 'server-a', syncStatus: 'pending' });
  const right = contact({ remoteId: 'server-b', syncStatus: 'synced' });

  assert.equal(contactContentHash(left), contactContentHash(right));
});

test('contact manifest uses client identity and server id only as metadata', () => {
  assert.deepEqual(contactManifestRow(contact({ id: 'contact-client-1', remoteId: 'server-1' })), {
    clientId: 'contact-client-1',
    serverId: 'server-1',
    status: 'confirmed',
    contentHash: contactContentHash(contact({ id: 'contact-client-1', remoteId: 'server-1' })),
    identityKeys: ['phone:+353123'],
  });
});

test('local-only contact is pushed and remote-only contact is pulled', () => {
  const localOnly = contact({ id: 'contact-local-only' });
  const remoteOnly = contactManifestRow(contact({ id: 'contact-remote-only', displayName: 'Beth Jones' }));

  const diff = diffContactManifest({
    localContacts: [localOnly],
    remoteManifest: [remoteOnly],
    aliases: [],
  });

  assert.deepEqual(diff.toPush.map(row => row.id), ['contact-local-only']);
  assert.deepEqual(diff.toPullClientIds, ['contact-remote-only']);
});

test('exact duplicate remote contact creates alias instead of push', () => {
  const local = contact({ id: 'contact-alan' });
  const remote = contactManifestRow(contact({ id: 'contact-alain' }));

  const diff = diffContactManifest({
    localContacts: [local],
    remoteManifest: [remote],
    aliases: [],
  });

  assert.deepEqual(diff.toPush, []);
  assert.deepEqual(diff.localAliases, [{
    collection: 'contacts',
    fromClientId: 'contact-alan',
    toClientId: 'contact-alain',
    reason: 'content_hash_match',
  }]);
});

test('repeated sync with existing alias does not push duplicate', () => {
  const local = contact({ id: 'contact-alan' });
  const remote = contactManifestRow(contact({ id: 'contact-alain' }));

  const diff = diffContactManifest({
    localContacts: [local],
    remoteManifest: [remote],
    aliases: [{ fromClientId: 'contact-alan', toClientId: 'contact-alain' }],
  });

  assert.deepEqual(diff.toPush, []);
  assert.deepEqual(diff.localAliases, []);
});

test('Location content hash ignores volatile replica metadata', () => {
  const left = location({ syncStatus: 'pending', remoteId: 'server-a' });
  const right = location({ syncStatus: 'synced', remoteId: 'server-b' });

  assert.equal(locationContentHash(left), locationContentHash(right));
});

test('Location manifest uses Client ID with identity keys', () => {
  const row = locationManifestRow(location());

  assert.equal(row.id, LOCATION_ID);
  assert.equal(row.status, 'active');
  assert.equal(row.contentHash, locationContentHash(location()));
  assert.deepEqual(row.identityKeys, locationIdentityKeys(location()));
  assert.equal(Object.prototype.hasOwnProperty.call(row, 'remoteId'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(row, 'localId'), false);
});

test('local-only Location is pushed and remote-only Location is pulled', () => {
  const diff = diffLocationManifest({
    localLocations: [location({ id: LOCATION_ID })],
    remoteManifest: [locationManifestRow(location({ id: LOCATION_ID_2, displayName: '22 King Road' }))],
    aliases: [],
  });

  assert.deepEqual(diff.toPush.map(row => row.id), [LOCATION_ID]);
  assert.deepEqual(diff.toPullIds, [LOCATION_ID_2]);
});

test('same Location Client ID pushes newer local content', () => {
  const local = location({
    displayName: '14 Bell Street Yard',
    updated_at: '2026-06-05T12:02:00.000Z',
  });
  const remote = {
    ...locationManifestRow(location()),
    updatedAt: '2026-06-05T12:01:00.000Z',
  };

  const diff = diffLocationManifest({
    localLocations: [local],
    remoteManifest: [remote],
    aliases: [],
  });

  assert.deepEqual(diff.toPush.map(row => row.id), [LOCATION_ID]);
  assert.deepEqual(diff.toPullIds, []);
});

test('same Location Client ID pulls newer or tied remote content', () => {
  const local = location({
    displayName: '14 Bell Street Yard',
    updated_at: '2026-06-05T12:01:00.000Z',
  });
  const remote = {
    ...locationManifestRow(location()),
    updatedAt: '2026-06-05T12:01:00.000Z',
  };

  const diff = diffLocationManifest({
    localLocations: [local],
    remoteManifest: [remote],
    aliases: [],
  });

  assert.deepEqual(diff.toPush, []);
  assert.deepEqual(diff.toPullIds, [LOCATION_ID]);
});

test('exact duplicate remote Location creates alias instead of push', () => {
  const local = location({ id: LOCATION_ID });
  const remote = locationManifestRow(location({ id: LOCATION_ID_2 }));

  const diff = diffLocationManifest({
    localLocations: [local],
    remoteManifest: [remote],
    aliases: [],
  });

  assert.deepEqual(diff.toPush, []);
  assert.deepEqual(diff.localAliases, [{
    collection: 'locations',
    fromClientId: LOCATION_ID,
    toClientId: LOCATION_ID_2,
    reason: 'identity_key_match',
  }]);
});

test('contact replica push sends canonical fields without local sync metadata', async () => {
  let pushedContacts;
  const result = await syncContactReplica({
    auth: { isLoggedIn: () => true },
    db: {
      getContactsForReplica: async () => [
        contact({
          id: 'contact-local-1',
          syncStatus: 'pending',
          synced_at: null,
          created_at: '2026-05-17T01:00:00.000Z',
          updated_at: '2026-05-17T01:01:00.000Z',
        }),
      ],
      saveContactAlias: async () => {},
      upsertCloudContact: async () => {},
    },
    api: {
      getContactManifest: async () => ({ contacts: [], aliases: [] }),
      pushContactAliases: async () => ({ aliases: [] }),
      pullContacts: async () => ({ contacts: [], aliases: [] }),
      pushContacts: async (contacts) => {
        pushedContacts = contacts;
        return { contacts: [], aliases: [] };
      },
    },
  });

  assert.equal(result.pushed, 0);
  assert.equal(pushedContacts[0].clientId, 'contact-local-1');
  assert.equal(pushedContacts[0].createdAt, '2026-05-17T01:00:00.000Z');
  assert.equal(pushedContacts[0].updatedAt, '2026-05-17T01:01:00.000Z');
  assert.equal(Object.prototype.hasOwnProperty.call(pushedContacts[0], 'created_at'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(pushedContacts[0], 'updated_at'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(pushedContacts[0], 'synced_at'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(pushedContacts[0], 'syncStatus'), false);
});

test('Location replica push sends canonical fields without remote/local metadata', async () => {
  let pushedLocations;
  const result = await syncLocationReplica({
    auth: { isLoggedIn: () => true },
    db: {
      getLocationsForReplica: async () => [
        location({
          syncStatus: 'pending',
          remoteId: 'server-1',
        }),
      ],
      saveLocationAlias: async () => {},
      upsertCloudLocation: async () => {},
    },
    api: {
      getLocationReplicaManifest: async () => ({ locations: [], aliases: [] }),
      pushLocationAliases: async () => ({ aliases: [] }),
      pullLocationsForReplica: async () => ({ locations: [], aliases: [] }),
      pushLocationsForReplica: async (locations) => {
        pushedLocations = locations;
        return { locations: [], aliases: [] };
      },
    },
  });

  assert.equal(result.pushed, 0);
  assert.equal(pushedLocations[0].id, LOCATION_ID);
  assert.equal(pushedLocations[0].status, 'active');
  assert.equal(pushedLocations[0].createdAt, '2026-06-05T12:00:00.000Z');
  assert.equal(pushedLocations[0].updatedAt, '2026-06-05T12:01:00.000Z');
  assert.equal(Object.prototype.hasOwnProperty.call(pushedLocations[0], 'remoteId'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(pushedLocations[0], 'localId'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(pushedLocations[0], 'created_at'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(pushedLocations[0], 'updated_at'), false);
});
