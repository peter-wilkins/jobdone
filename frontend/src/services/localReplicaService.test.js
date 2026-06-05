import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  contactContentHash,
  contactManifestRow,
  diffContactManifest,
  syncContactReplica,
} from './localReplicaService.js';

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
