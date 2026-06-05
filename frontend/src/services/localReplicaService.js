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

function normalizeLocationStatus(status) {
  if (status === 'archived') return 'archived';
  return 'active';
}

function normalizeLocationText(value) {
  return String(value || '')
    .normalize('NFKC')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function roundedCoordinate(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? Number(number.toFixed(6)) : null;
}

export function canonicalLocationForHash(location = {}) {
  return {
    status: normalizeLocationStatus(location.status),
    displayName: String(location.displayName || '').trim(),
    placeText: String(location.placeText || '').trim(),
    addressText: String(location.addressText || '').trim(),
    latitude: roundedCoordinate(location.latitude),
    longitude: roundedCoordinate(location.longitude),
    providerPlaceId: location.providerPlaceId || null,
  };
}

export function locationContentHash(location = {}) {
  return stableHash(canonicalLocationForHash(location));
}

export function locationIdentityKeys(location = {}) {
  const providerPlaceId = String(location.providerPlaceId || '').trim();
  const displayName = normalizeLocationText(location.displayName || location.placeText || location.addressText);
  const addressText = normalizeLocationText(location.addressText);
  const latitude = roundedCoordinate(location.latitude);
  const longitude = roundedCoordinate(location.longitude);
  return unique([
    providerPlaceId ? `provider:${providerPlaceId}` : '',
    displayName && addressText ? `label-address:${displayName}:${addressText}` : '',
    displayName && latitude !== null && longitude !== null ? `label-coordinates:${displayName}:${latitude}:${longitude}` : '',
  ]);
}

export function locationManifestRow(location = {}) {
  return {
    id: location.id,
    status: normalizeLocationStatus(location.status),
    contentHash: location.contentHash || locationContentHash(location),
    identityKeys: location.identityKeys || locationIdentityKeys(location),
    updatedAt: location.updatedAt || location.updated_at || location.createdAt || location.created_at || null,
  };
}

function isNewer(leftUpdatedAt, rightUpdatedAt) {
  const left = new Date(leftUpdatedAt || 0).getTime();
  const right = new Date(rightUpdatedAt || 0).getTime();
  if (!Number.isFinite(left) || !Number.isFinite(right)) return false;
  return left > right;
}

export function diffLocationManifest({ localLocations = [], remoteManifest = [], aliases = [] } = {}) {
  const aliasFrom = new Set(aliases.map(alias => alias.fromClientId).filter(Boolean));
  const localById = new Map(localLocations.map(location => [location.id, location]));
  const remoteById = new Map(remoteManifest.map(row => [row.id, row]));
  const remoteByIdentityKey = new Map();
  for (const row of remoteManifest) {
    for (const key of row.identityKeys || []) {
      if (!remoteByIdentityKey.has(key)) remoteByIdentityKey.set(key, row);
    }
  }

  const toPush = [];
  const toPullIds = [];
  const localAliases = [];

  for (const location of localLocations) {
    const row = locationManifestRow(location);
    if (!row.id || aliasFrom.has(row.id)) continue;
    const remote = remoteById.get(row.id);
    if (remote) {
      if (remote.contentHash !== row.contentHash && isNewer(row.updatedAt, remote.updatedAt)) {
        toPush.push(location);
      }
      continue;
    }

    const duplicate = row.identityKeys
      .map(key => remoteByIdentityKey.get(key))
      .find(candidate => candidate?.id && candidate.id !== row.id);
    if (duplicate) {
      localAliases.push({
        collection: 'locations',
        fromClientId: row.id,
        toClientId: duplicate.id,
        reason: 'identity_key_match',
      });
      continue;
    }

    toPush.push(location);
  }

  for (const row of remoteManifest) {
    if (!row.id || aliasFrom.has(row.id)) continue;
    const local = localById.get(row.id);
    if (!local) {
      toPullIds.push(row.id);
      continue;
    }
    const localRow = locationManifestRow(local);
    if (row.contentHash !== localRow.contentHash && !isNewer(localRow.updatedAt, row.updatedAt)) {
      toPullIds.push(row.id);
    }
  }

  return { toPush, toPullIds, localAliases };
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

export async function syncLocationReplica({ db = dbService, api = apiService, auth = authService } = {}) {
  if (!auth.isLoggedIn()) return { pushed: 0, pulled: 0, aliases: 0, skipped: true };

  const localLocations = await db.getLocationsForReplica();
  const localManifest = localLocations.map(locationManifestRow);
  const remote = await api.getLocationReplicaManifest({ locations: localManifest });
  const remoteManifest = remote.locations || [];
  const remoteAliases = remote.aliases || [];
  for (const alias of remoteAliases) await db.saveLocationAlias(alias);

  const { toPush, toPullIds, localAliases } = diffLocationManifest({
    localLocations,
    remoteManifest,
    aliases: remoteAliases,
  });

  for (const alias of localAliases) await db.saveLocationAlias(alias);
  const savedLocalAliases = localAliases.length
    ? await api.pushLocationAliases(localAliases)
    : { aliases: [] };

  const pushed = toPush.length ? await api.pushLocationsForReplica(toPush.map(location => ({
    id: location.id,
    status: normalizeLocationStatus(location.status),
    displayName: location.displayName || '',
    placeText: location.placeText || '',
    addressText: location.addressText || '',
    latitude: location.latitude ?? null,
    longitude: location.longitude ?? null,
    providerPlaceId: location.providerPlaceId || null,
    contentHash: locationContentHash(location),
    createdAt: location.created_at || location.createdAt || null,
    updatedAt: location.updated_at || location.updatedAt || location.created_at || location.createdAt || null,
  }))) : { locations: [], aliases: [] };

  const pulled = toPullIds.length ? await api.pullLocationsForReplica(toPullIds) : { locations: [], aliases: [] };
  const aliases = [...(savedLocalAliases.aliases || []), ...(pushed.aliases || []), ...(pulled.aliases || [])];
  for (const alias of aliases) await db.saveLocationAlias(alias);

  for (const location of [...(pushed.locations || []), ...(pulled.locations || [])]) {
    await db.upsertCloudLocation(location);
  }

  return {
    pushed: pushed.locations?.length || 0,
    pulled: pulled.locations?.length || 0,
    aliases: remoteAliases.length + localAliases.length + aliases.length,
    skipped: false,
  };
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
    id: contact.id,
    localId: contact.id,
    remoteId: contact.remoteId || null,
    clientId: contactClientId(contact),
    status: contact.status || 'confirmed',
    displayName: contact.displayName || '',
    givenName: contact.givenName || '',
    familyName: contact.familyName || '',
    organization: contact.organization || '',
    title: contact.title || '',
    note: contact.note || '',
    phones: contact.phones || [],
    emails: contact.emails || [],
    normalizedPhones: contact.normalizedPhones || [],
    normalizedEmails: contact.normalizedEmails || [],
    primaryPhone: contact.primaryPhone || null,
    primaryEmail: contact.primaryEmail || null,
    sourceCaptureIds: contact.sourceCaptureIds || [],
    contentHash: contactContentHash(contact),
    identityKeys: contactIdentityKeys(contact),
    createdAt: contact.created_at || null,
    updatedAt: contact.updated_at || null,
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
