const BASE_TIME_MS = Date.UTC(2026, 5, 6, 12, 0, 0);

const COLLECTIONS = [
  'entries',
  'contacts',
  'locations',
  'entryContacts',
  'entryLocations',
  'teamBacklogItems',
  'approvalRequests',
];

const ACTIONS = [
  'createObject',
  'updateObject',
  'deleteObject',
  'claimBacklogItem',
  'submitApprovalRequest',
];

function lcg(seed) {
  let state = (Number(seed) || 1) >>> 0;
  return () => {
    state = (Math.imul(1664525, state) + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

function int(random, min, max) {
  return min + Math.floor(random() * (max - min + 1));
}

function pick(random, values) {
  return values[Math.floor(random() * values.length)];
}

function hexByte(value) {
  return value.toString(16).padStart(2, '0');
}

function uuidV7FromParts(seed, sequence) {
  const timestamp = Math.max(0, Math.min(BASE_TIME_MS + seed * 1000 + sequence, 0xffffffffffff));
  const random = lcg(seed * 1000003 + sequence * 9176 + 17);
  const bytes = Array.from({ length: 16 }, () => int(random, 0, 255));

  bytes[0] = Math.floor(timestamp / 0x10000000000) & 0xff;
  bytes[1] = Math.floor(timestamp / 0x100000000) & 0xff;
  bytes[2] = Math.floor(timestamp / 0x1000000) & 0xff;
  bytes[3] = Math.floor(timestamp / 0x10000) & 0xff;
  bytes[4] = Math.floor(timestamp / 0x100) & 0xff;
  bytes[5] = timestamp & 0xff;
  bytes[6] = (bytes[6] & 0x0f) | 0x70;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;

  const hex = bytes.map(hexByte);
  return `${hex.slice(0, 4).join('')}-${hex.slice(4, 6).join('')}-${hex.slice(6, 8).join('')}-${hex.slice(8, 10).join('')}-${hex.slice(10, 16).join('')}`;
}

function timestamp(seed, offset = 0) {
  return new Date(BASE_TIME_MS + seed * 1000 + offset * 1000).toISOString();
}

function payloadHash(seed, sequence) {
  return `sha256:${seed.toString(16)}:${sequence.toString(16)}`;
}

function ownerScope(seed, random) {
  const ownerKind = random() > 0.35 ? 'user' : 'team';
  return {
    ownerKind,
    ownerId: uuidV7FromParts(seed, ownerKind === 'user' ? 1 : 2),
  };
}

/**
 * @param {number} count
 * @param {number} start
 */
export function localReplicaSeeds(count = 50, start = 1) {
  return Array.from({ length: count }, (_, index) => start + index);
}

export function createLocalReplicaGenerator(seed = 1) {
  const random = lcg(seed);
  let sequence = 10;
  const nextSequence = () => {
    sequence += 1;
    return sequence;
  };

  const scope = ownerScope(seed, random);
  const replicaEpoch = uuidV7FromParts(seed, 3);
  const actorUserId = scope.ownerKind === 'user' ? scope.ownerId : uuidV7FromParts(seed, 4);

  function uuid() {
    return uuidV7FromParts(seed, nextSequence());
  }

  function syncTransaction(overrides = {}) {
    const t = overrides.t ?? int(random, 1, 5000);
    return {
      t,
      replicaEpoch,
      actorUserId,
      actorEmail: `user-${seed}@example.com`,
      actorDeviceId: `device-${seed}`,
      source: pick(random, ['syncPush', 'system', 'import', 'repair']),
      createdAt: timestamp(seed, t),
      ...overrides,
    };
  }

  function syncObject(overrides = {}) {
    const createdT = overrides.createdT ?? int(random, 1, 1000);
    const changedT = overrides.changedT ?? createdT + int(random, 0, 20);
    const deleted = overrides.deletedT !== undefined ? overrides.deletedT != null : random() > 0.8;
    const deletedT = overrides.deletedT !== undefined
      ? overrides.deletedT
      : deleted ? changedT + int(random, 0, 10) : null;
    const objectId = overrides.id ?? uuid();
    const collection = overrides.collection ?? pick(random, COLLECTIONS);

    return {
      id: objectId,
      ...scope,
      collection,
      createdT,
      changedT,
      deletedT,
      createdAt: timestamp(seed, createdT),
      changedAt: timestamp(seed, changedT),
      deletedAt: deletedT == null ? null : timestamp(seed, deletedT),
      codec: 'json',
      encryptionMode: 'none',
      payloadJson: {
        id: objectId,
        text: `Generated ${collection} ${seed}`,
        seed,
      },
      payloadBytes: null,
      payloadHash: payloadHash(seed, changedT),
      schemaVersion: 1,
      ...overrides,
    };
  }

  function syncIntent(overrides = {}) {
    const collection = overrides.collection ?? pick(random, COLLECTIONS);
    return {
      id: uuid(),
      ...scope,
      collection,
      action: overrides.action ?? pick(random, ACTIONS),
      objectId: overrides.objectId ?? uuid(),
      baseObjectT: overrides.baseObjectT ?? int(random, 0, 1000),
      payloadJson: {
        text: `Generated intent ${seed}`,
        seed,
      },
      payloadHash: payloadHash(seed, nextSequence()),
      createdAt: timestamp(seed, nextSequence()),
      ...overrides,
    };
  }

  function pullRequest(overrides = {}) {
    return {
      replicaEpoch,
      sinceT: int(random, 0, 1000),
      limit: int(random, 1, 100),
      ...overrides,
    };
  }

  function pullResponse(overrides = {}) {
    const fromT = overrides.fromT ?? int(random, 0, 1000);
    const toT = overrides.toT ?? fromT + int(random, 0, 100);
    return {
      replicaEpoch,
      fromT,
      toT,
      hasMore: random() > 0.6,
      objects: [syncObject({ changedT: Math.max(1, toT), createdT: Math.max(1, fromT) })],
      ...overrides,
    };
  }

  function pushRequest(overrides = {}) {
    return {
      replicaEpoch,
      baseT: int(random, 0, 1000),
      intents: [syncIntent()],
      ...overrides,
    };
  }

  function pushResponse(overrides = {}) {
    const baseT = overrides.baseT ?? int(random, 0, 1000);
    const toT = overrides.toT ?? baseT + int(random, 0, 50);
    const objectId = uuid();
    const intentId = uuid();
    return {
      replicaEpoch,
      baseT,
      toT,
      results: [{
        intentId,
        status: pick(random, ['accepted', 'idempotent', 'conflict', 'rejected']),
        t: toT,
        objectId,
        reason: null,
      }],
      objects: [syncObject({ id: objectId, createdT: Math.max(1, baseT), changedT: Math.max(1, toT) })],
      ...overrides,
    };
  }

  return {
    seed,
    uuid,
    timestamp: offset => timestamp(seed, offset),
    ownerScope: () => ({ ...scope }),
    syncTransaction,
    syncObject,
    syncIntent,
    pullRequest,
    pullResponse,
    pushRequest,
    pushResponse,
  };
}

export function validLocalReplicaCase(seed = 1) {
  const generator = createLocalReplicaGenerator(seed);
  return {
    syncObject: generator.syncObject(),
    syncTransaction: generator.syncTransaction(),
    syncIntent: generator.syncIntent(),
    pullRequest: generator.pullRequest(),
    pullResponse: generator.pullResponse(),
    pushRequest: generator.pushRequest(),
    pushResponse: generator.pushResponse(),
  };
}

export function invalidLocalReplicaCases(seed = 1) {
  const generator = createLocalReplicaGenerator(seed);
  const validObject = generator.syncObject();
  const validIntent = generator.syncIntent();
  const validPullRequest = generator.pullRequest();
  const validPullResponse = generator.pullResponse();
  const validPushRequest = generator.pushRequest();
  const validPushResponse = generator.pushResponse();
  const validTransaction = generator.syncTransaction();

  return [
    {
      kind: 'syncObject',
      name: 'rejects snake_case owner scope',
      payload: { ...validObject, owner_id: validObject.ownerId },
    },
    {
      kind: 'syncObject',
      name: 'rejects backend id leak',
      payload: { ...validObject, remoteId: uuidV7FromParts(seed, 900) },
    },
    {
      kind: 'syncObject',
      name: 'rejects non UUIDv7 object id',
      payload: { ...validObject, id: '2a091a40-b350-4d2f-9d91-4c4b5042e01f' },
    },
    {
      kind: 'syncObject',
      name: 'rejects snake_case collection',
      payload: { ...validObject, collection: 'entry_contacts' },
    },
    {
      kind: 'syncObject',
      name: 'rejects changedT before createdT',
      payload: { ...validObject, createdT: 20, changedT: 19 },
    },
    {
      kind: 'syncObject',
      name: 'rejects forbidden nested payload fields',
      payload: { ...validObject, payloadJson: { serverId: 'backend-private' } },
    },
    {
      kind: 'syncTransaction',
      name: 'rejects unknown transaction source',
      payload: { ...validTransaction, source: 'unknown' },
    },
    {
      kind: 'syncIntent',
      name: 'rejects snake_case action',
      payload: { ...validIntent, action: 'create_object' },
    },
    {
      kind: 'pullRequest',
      name: 'rejects negative sinceT',
      payload: { ...validPullRequest, sinceT: -1 },
    },
    {
      kind: 'pullResponse',
      name: 'rejects inverted Server T window',
      payload: { ...validPullResponse, fromT: 10, toT: 9 },
    },
    {
      kind: 'pushRequest',
      name: 'rejects snake_case envelope field',
      payload: { ...validPushRequest, base_t: validPushRequest.baseT },
    },
    {
      kind: 'pushResponse',
      name: 'rejects unknown result status',
      payload: {
        ...validPushResponse,
        results: [{ ...validPushResponse.results[0], status: 'done' }],
      },
    },
  ];
}
