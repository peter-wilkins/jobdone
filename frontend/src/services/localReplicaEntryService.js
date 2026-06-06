import { apiService } from './apiService.js';
import { authService } from './authService.js';
import { dbService } from './dbService.js';
import {
  queueCreateObjectIntent,
  stableLocalReplicaHash,
  syncLocalReplicaOnce,
} from './localReplicaSyncAdapter.js';

export const ENTRY_COLLECTION = 'entries';

function envValue(name) {
  return (import.meta.env || {})[name];
}

export function isLocalReplicaEntrySyncEnabled(value = envValue('VITE_LOCAL_REPLICA_ENTRY_SYNC')) {
  return value === true || value === 'true' || value === 'entries';
}

function compactArray(value) {
  return Array.isArray(value) ? value.filter(Boolean) : [];
}

function entryText(entry = {}) {
  return String(entry.text || entry.summary || entry.transcript || '').trim();
}

export function entryToLocalReplicaPayload(entry = {}) {
  return {
    id: entry.id,
    text: entryText(entry),
    createdAt: entry.createdAt || new Date().toISOString(),
    locations: compactArray(entry.locations),
    contacts: compactArray(entry.contacts),
    attachments: compactArray(entry.attachments).map(attachment => ({
      id: attachment.id,
      kind: attachment.kind || 'file',
      status: attachment.status || 'ready',
      filename: attachment.filename || attachment.originalName || '',
      mimeType: attachment.mimeType || attachment.originalType || '',
      size: attachment.size || attachment.originalSize || 0,
    })),
    workContexts: compactArray(entry.workContexts),
  };
}

export function entryFromLocalReplicaObject(object = {}, existing = null) {
  const payload = object.payloadJson || {};
  const text = String(payload.text || '').trim();
  const status = object.deletedT == null ? 'confirmed' : 'deleted';
  return {
    ...(existing || {}),
    id: object.id,
    remoteId: null,
    audioBlob: existing?.audioBlob || null,
    audioSize: existing?.audioSize || 0,
    audioDuration: existing?.audioDuration || null,
    status,
    syncStatus: 'synced',
    errorMessage: null,
    text,
    transcript: text,
    summary: text,
    createdAt: payload.createdAt || object.createdAt || existing?.createdAt || new Date().toISOString(),
    syncedAt: object.changedAt || new Date().toISOString(),
    captureId: null,
    locations: compactArray(payload.locations),
    contacts: compactArray(payload.contacts),
    tags: compactArray(payload.tags),
    attachments: compactArray(payload.attachments),
    workContexts: compactArray(payload.workContexts),
  };
}

async function pendingEntries(db) {
  if (typeof db.getConfirmedEntriesPendingLocalReplica === 'function') {
    return db.getConfirmedEntriesPendingLocalReplica();
  }
  return db.getConfirmedEntriesUnsynced();
}

async function queueEntryIntents({ db, ownerScope, entries }) {
  for (const entry of entries) {
    const payloadJson = entryToLocalReplicaPayload(entry);
    await queueCreateObjectIntent({
      store: db,
      ownerScope,
      collection: ENTRY_COLLECTION,
      objectId: entry.id,
      payloadJson,
      now: payloadJson.createdAt,
      createId: undefined,
    });
  }
}

async function materializeEntryObjects({ db, objects }) {
  if (typeof db.putLocalReplicaEntry !== 'function') return 0;

  let saved = 0;
  const seen = new Set();
  for (const object of objects || []) {
    if (object.collection !== ENTRY_COLLECTION) continue;
    const key = `${object.ownerKind}:${object.ownerId}:${object.collection}:${object.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const existing = typeof db.getEntry === 'function' ? await db.getEntry(object.id) : null;
    const entry = entryFromLocalReplicaObject(object, existing);
    await db.putLocalReplicaEntry(entry);
    saved += 1;
  }
  return saved;
}

export async function syncEntryReplica({
  db = dbService,
  api = apiService,
  auth = authService,
  limit = 100,
} = {}) {
  if (!auth.isLoggedIn()) {
    return { pushed: 0, pulled: 0, conflicts: 0, rejected: 0, materialized: 0, skipped: true };
  }

  const ownerId = auth.getUserId?.();
  if (!ownerId) {
    return { pushed: 0, pulled: 0, conflicts: 0, rejected: 0, materialized: 0, skipped: true };
  }

  const entries = await pendingEntries(db);
  await queueEntryIntents({
    db,
    ownerScope: { ownerKind: 'user', ownerId },
    entries,
  });

  const syncResult = await syncLocalReplicaOnce({ store: db, api, limit });
  const materialized = await materializeEntryObjects({ db, objects: syncResult.objects });
  const resultStatuses = syncResult.results || [];

  return {
    pushed: syncResult.pushed,
    pulled: syncResult.pulled,
    conflicts: resultStatuses.filter(result => result.status === 'conflict').length,
    rejected: resultStatuses.filter(result => result.status === 'rejected').length,
    materialized,
    skipped: false,
  };
}

export function entryPayloadHash(entry = {}) {
  return stableLocalReplicaHash(entryToLocalReplicaPayload(entry));
}
