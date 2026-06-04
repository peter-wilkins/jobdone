import { apiService } from './apiService.js';
import { authService } from './authService.js';
import { dbService } from './dbService.js';

function unique(values = []) {
  return Array.from(new Set((values || []).filter(Boolean)));
}

function sortContactValues(values = []) {
  return [...(values || [])]
    .map(value => ({
      value: String(value?.value || ''),
      normalized: String(value?.normalized || value?.value || '').toLowerCase(),
      label: String(value?.label || ''),
    }))
    .sort((left, right) => `${left.normalized}:${left.value}`.localeCompare(`${right.normalized}:${right.value}`));
}

export function canonicalContactForHash(contact = {}) {
  return {
    displayName: String(contact.displayName || '').trim(),
    givenName: String(contact.givenName || '').trim(),
    familyName: String(contact.familyName || '').trim(),
    organization: String(contact.organization || '').trim(),
    title: String(contact.title || '').trim(),
    note: String(contact.note || '').trim(),
    phones: sortContactValues(contact.phones),
    emails: sortContactValues(contact.emails),
    normalizedPhones: unique(contact.normalizedPhones || []).sort(),
    normalizedEmails: unique(contact.normalizedEmails || []).sort(),
    primaryPhone: contact.primaryPhone || '',
    primaryEmail: contact.primaryEmail || '',
  };
}

export function stableHash(value) {
  const input = JSON.stringify(value);
  let hash = 2166136261;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

export function contactContentHash(contact = {}) {
  return stableHash(canonicalContactForHash(contact));
}

export function contactClientId(contact = {}) {
  return contact.clientId || contact.id || contact.localId || contact.local_id || '';
}

export function contactIdentityKeys(contact = {}) {
  return unique([
    ...(contact.normalizedEmails || []).map(value => `email:${value}`),
    ...(contact.normalizedPhones || []).map(value => `phone:${value}`),
  ]);
}

export function contactManifestRow(contact = {}) {
  const clientId = contactClientId(contact);
  return {
    clientId,
    serverId: contact.serverId || contact.remoteId || null,
    status: contact.status || 'confirmed',
    contentHash: contact.contentHash || contactContentHash(contact),
    identityKeys: contactIdentityKeys(contact),
  };
}

export function diffContactManifest({ localContacts = [], remoteManifest = [], aliases = [] } = {}) {
  const aliasFrom = new Set(aliases.map(alias => alias.fromClientId).filter(Boolean));
  const localByClientId = new Map(localContacts.map(contact => [contactClientId(contact), contact]));
  const remoteByClientId = new Map(remoteManifest.map(row => [row.clientId, row]));
  const remoteByHash = new Map(remoteManifest.map(row => [row.contentHash, row]).filter(([hash]) => hash));
  const toPush = [];
  const toPullClientIds = [];
  const localAliases = [];

  for (const contact of localContacts) {
    const row = contactManifestRow(contact);
    if (!row.clientId || aliasFrom.has(row.clientId) || remoteByClientId.has(row.clientId)) continue;
    const duplicate = remoteByHash.get(row.contentHash);
    if (duplicate?.clientId && duplicate.clientId !== row.clientId) {
      localAliases.push({
        collection: 'contacts',
        fromClientId: row.clientId,
        toClientId: duplicate.clientId,
        reason: 'content_hash_match',
      });
      continue;
    }
    toPush.push(contact);
  }

  for (const row of remoteManifest) {
    if (!row.clientId || aliasFrom.has(row.clientId) || localByClientId.has(row.clientId)) continue;
    toPullClientIds.push(row.clientId);
  }

  return { toPush, toPullClientIds, localAliases };
}

export async function syncContactReplica({ db = dbService, api = apiService, auth = authService } = {}) {
  if (!auth.isLoggedIn()) return { pushed: 0, pulled: 0, aliases: 0, skipped: true };

  const localContacts = await db.getContactsForReplica();
  const localManifest = localContacts.map(contactManifestRow);
  const remote = await api.getContactManifest({ contacts: localManifest });
  const remoteManifest = remote.contacts || [];
  const remoteAliases = remote.aliases || [];
  for (const alias of remoteAliases) await db.saveContactAlias(alias);

  const { toPush, toPullClientIds, localAliases } = diffContactManifest({
    localContacts,
    remoteManifest,
    aliases: remoteAliases,
  });

  for (const alias of localAliases) await db.saveContactAlias(alias);
  const savedLocalAliases = localAliases.length
    ? await api.pushContactAliases(localAliases)
    : { aliases: [] };

  const pushed = toPush.length ? await api.pushContacts(toPush.map(contact => ({
    ...contact,
    clientId: contactClientId(contact),
    contentHash: contactContentHash(contact),
    identityKeys: contactIdentityKeys(contact),
  }))) : { contacts: [], aliases: [] };

  const pulled = toPullClientIds.length ? await api.pullContacts(toPullClientIds) : { contacts: [], aliases: [] };

  const aliases = [...(savedLocalAliases.aliases || []), ...(pushed.aliases || []), ...(pulled.aliases || [])];
  for (const alias of aliases) await db.saveContactAlias(alias);

  for (const contact of [...(pushed.contacts || []), ...(pulled.contacts || [])]) {
    await db.upsertCloudContact(contact);
  }

  return {
    pushed: pushed.contacts?.length || 0,
    pulled: pulled.contacts?.length || 0,
    aliases: remoteAliases.length + localAliases.length + aliases.length,
    skipped: false,
  };
}
