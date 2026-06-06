import { createUuidV7 } from '../../../shared/contracts/clientId.js';
import {
  parsePullRequest,
  parsePullResponse,
  parsePushRequest,
  parsePushResponse,
  parseSyncIntent,
  parseSyncObject,
} from '../contracts/localReplica.js';
import { LOCAL_REPLICA_STATE_ID, localReplicaObjectKey } from './localReplicaStorage.js';

function parseOrThrow(parsed, fallbackMessage) {
  if (parsed.success) return parsed.data;
  throw new Error(parsed.error || fallbackMessage);
}

function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (!value || typeof value !== 'object') return JSON.stringify(value);
  return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
}

export function stableLocalReplicaHash(value) {
  const input = stableStringify(value);
  let hash = 2166136261;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `fnv1a:${(hash >>> 0).toString(16).padStart(8, '0')}`;
}

function normalizeState(state = {}) {
  return {
    id: LOCAL_REPLICA_STATE_ID,
    replicaEpoch: state.replicaEpoch || createUuidV7(),
    lastPulledT: Number(state.lastPulledT || 0),
    lastKnownServerT: Number(state.lastKnownServerT || state.lastPulledT || 0),
    updatedAt: state.updatedAt || null,
  };
}

function nextPullCursor(response) {
  if (!response.hasMore) return response.toT;
  return Math.max(
    response.fromT,
    ...response.objects.map(object => object.changedT),
  );
}

function materializedRowFromObject(object) {
  return {
    key: localReplicaObjectKey(object),
    ownerKind: object.ownerKind,
    ownerId: object.ownerId,
    collection: object.collection,
    id: object.id,
    changedT: object.changedT,
    deletedT: object.deletedT,
    schemaVersion: object.schemaVersion,
    payloadJson: object.payloadJson,
  };
}

function syncIntentContractFields(intent = {}) {
  return {
    id: intent.id,
    ownerKind: intent.ownerKind,
    ownerId: intent.ownerId,
    collection: intent.collection,
    action: intent.action,
    objectId: intent.objectId ?? null,
    baseObjectT: intent.baseObjectT ?? null,
    payloadJson: intent.payloadJson || {},
    payloadHash: intent.payloadHash ?? null,
    createdAt: intent.createdAt,
  };
}

export class MemoryLocalReplicaStore {
  constructor({ replicaEpoch = createUuidV7(), state = {} } = {}) {
    this.state = normalizeState({ replicaEpoch, ...state });
    this.syncObjects = new Map();
    this.materialized = new Map();
    this.intents = new Map();
  }

  async getLocalReplicaState() {
    return { ...this.state };
  }

  async saveLocalReplicaState(state) {
    this.state = normalizeState({ ...this.state, ...state, updatedAt: state.updatedAt || new Date().toISOString() });
    return { ...this.state };
  }

  async saveLocalReplicaIntent(intent, metadata = {}) {
    const parsed = parseOrThrow(parseSyncIntent(intent), 'Invalid Local Replica Sync Intent');
    const row = {
      ...parsed,
      status: metadata.status || 'pending',
      result: metadata.result || null,
    };
    this.intents.set(row.id, row);
    return row;
  }

  async listPendingIntents() {
    return [...this.intents.values()]
      .filter(intent => intent.status === 'pending')
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id));
  }

  async markLocalReplicaIntentSettled(intentId, result) {
    const existing = this.intents.get(intentId);
    if (!existing) return null;
    const next = {
      ...existing,
      status: 'settled',
      result,
      settledAt: new Date().toISOString(),
    };
    this.intents.set(intentId, next);
    return next;
  }

  async materializeLocalReplicaObject(object) {
    const parsed = parseOrThrow(parseSyncObject(object), 'Invalid Local Replica Sync Object');
    const key = localReplicaObjectKey(parsed);
    this.syncObjects.set(key, parsed);
    if (parsed.deletedT != null) {
      this.materialized.delete(key);
      return null;
    }
    const row = materializedRowFromObject(parsed);
    this.materialized.set(key, row);
    return row;
  }

  async getMaterializedSnapshot() {
    const collections = {};
    for (const row of this.materialized.values()) {
      collections[row.collection] ||= [];
      collections[row.collection].push({
        ownerKind: row.ownerKind,
        ownerId: row.ownerId,
        collection: row.collection,
        id: row.id,
        changedT: row.changedT,
        schemaVersion: row.schemaVersion,
        ...row.payloadJson,
      });
    }
    for (const rows of Object.values(collections)) {
      rows.sort((left, right) => left.id.localeCompare(right.id));
    }
    return { collections };
  }
}

export function createMemoryLocalReplicaStore(options = {}) {
  return new MemoryLocalReplicaStore(options);
}

export async function queueCreateObjectIntent({
  store,
  ownerScope,
  collection,
  objectId,
  payloadJson,
  now = new Date().toISOString(),
  createId = createUuidV7,
} = {}) {
  if (!store) throw new Error('Local Replica store is required');
  const state = await store.getLocalReplicaState();
  const id = createId();
  const payload = {
    id,
    ownerKind: ownerScope.ownerKind,
    ownerId: ownerScope.ownerId,
    collection,
    action: 'createObject',
    objectId,
    baseObjectT: null,
    payloadJson,
    payloadHash: stableLocalReplicaHash(payloadJson),
    createdAt: now,
  };
  const intent = parseOrThrow(parseSyncIntent(payload), 'Invalid Local Replica create intent');
  await store.saveLocalReplicaIntent(intent);
  return {
    ...intent,
    replicaEpoch: state.replicaEpoch,
  };
}

export async function applyPushResponse({ store, response }) {
  const parsed = parseOrThrow(parsePushResponse(response), 'Invalid Local Replica push response');
  for (const result of parsed.results) {
    await store.markLocalReplicaIntentSettled(result.intentId, result);
  }
  for (const object of parsed.objects) {
    await store.materializeLocalReplicaObject(object);
  }
  const state = await store.getLocalReplicaState();
  await store.saveLocalReplicaState({
    ...state,
    lastKnownServerT: Math.max(state.lastKnownServerT || 0, parsed.toT),
  });
  return parsed;
}

export async function applyPullResponse({ store, response }) {
  const parsed = parseOrThrow(parsePullResponse(response), 'Invalid Local Replica pull response');
  for (const object of parsed.objects) {
    await store.materializeLocalReplicaObject(object);
  }
  const state = await store.getLocalReplicaState();
  await store.saveLocalReplicaState({
    ...state,
    lastPulledT: nextPullCursor(parsed),
    lastKnownServerT: Math.max(state.lastKnownServerT || 0, parsed.toT),
  });
  return parsed;
}

export async function syncLocalReplicaOnce({ store, api, limit = 100 } = {}) {
  if (!store) throw new Error('Local Replica store is required');
  if (!api) throw new Error('Local Replica API is required');

  let state = await store.getLocalReplicaState();
  const pending = await store.listPendingIntents();
  let pushed = 0;
  let pulled = 0;

  if (pending.length) {
    const pushRequest = parseOrThrow(parsePushRequest({
      replicaEpoch: state.replicaEpoch,
      baseT: state.lastPulledT,
      intents: pending.map(intent =>
        parseOrThrow(parseSyncIntent(syncIntentContractFields(intent)), 'Invalid pending Local Replica intent')
      ),
    }), 'Invalid Local Replica push request');
    const pushResponse = await api.pushLocalReplica(pushRequest);
    const parsedPush = await applyPushResponse({ store, response: pushResponse });
    pushed = parsedPush.results.filter(result => ['accepted', 'idempotent'].includes(result.status)).length;
  }

  for (let page = 0; page < 20; page += 1) {
    state = await store.getLocalReplicaState();
    const pullRequest = parseOrThrow(parsePullRequest({
      replicaEpoch: state.replicaEpoch,
      sinceT: state.lastPulledT,
      limit,
    }), 'Invalid Local Replica pull request');
    const pullResponse = await api.pullLocalReplica(pullRequest);
    const parsedPull = await applyPullResponse({ store, response: pullResponse });
    pulled += parsedPull.objects.length;
    if (!parsedPull.hasMore || parsedPull.objects.length === 0) break;
  }

  state = await store.getLocalReplicaState();
  return {
    pushed,
    pulled,
    pending: (await store.listPendingIntents()).length,
    lastPulledT: state.lastPulledT,
    lastKnownServerT: state.lastKnownServerT,
  };
}
