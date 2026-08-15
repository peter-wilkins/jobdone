import { isUuidV7 } from './clientId.js';

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const collectionNamePattern = /^[a-z][A-Za-z0-9]*$/;

const forbiddenAppFacingFields = new Set([
  'backendId',
  'backend_id',
  'remoteId',
  'remote_id',
  'serverId',
  'server_id',
  'owner_id',
  'owner_kind',
  'created_t',
  'changed_t',
  'deleted_t',
  'created_at',
  'changed_at',
  'deleted_at',
  'updatedT',
  'updated_t',
  'updatedAt',
  'updated_at',
  'schema_version',
  'payload_json',
  'payload_bytes',
  'payload_hash',
  'encryption_mode',
]);

function formatIssue(issue) {
  if (issue.code === 'unrecognized_keys') {
    const keys = Array.isArray(issue.keys) ? issue.keys.join(', ') : 'unknown';
    const path = issue.path?.length ? issue.path.join('.') : 'payload';
    return `${path} has unrecognized field(s): ${keys}`;
  }
  return issue.message;
}

function findForbiddenFields(value, path = 'payload', errors = []) {
  if (!value || typeof value !== 'object') return errors;
  if (Array.isArray(value)) {
    value.forEach((item, index) => findForbiddenFields(item, `${path}.${index}`, errors));
    return errors;
  }

  for (const [key, child] of Object.entries(value)) {
    if (forbiddenAppFacingFields.has(key)) {
      errors.push(`${path}.${key} must not cross the Local Replica contract`);
    }
    findForbiddenFields(child, `${path}.${key}`, errors);
  }
  return errors;
}

function parseWithSchema(schema, payload, fallbackError) {
  const forbiddenErrors = findForbiddenFields(payload);
  if (forbiddenErrors.length) {
    return {
      success: false,
      error: forbiddenErrors[0],
      errors: forbiddenErrors,
    };
  }

  const result = schema.safeParse(payload);
  if (result.success) return { success: true, data: result.data };

  const errors = result.error.issues.map(formatIssue);
  return {
    success: false,
    error: errors[0] || fallbackError,
    errors,
  };
}

/**
 * @param {typeof import('zod').z} z
 */
export function buildLocalReplicaSchemas(z) {
  const uuidSchema = z.string().regex(uuidPattern, 'value must be a UUID');
  const uuidV7Schema = z.string().refine(isUuidV7, 'id must be a UUIDv7 Client ID');
  const tSchema = z.number().int().nonnegative();
  const optionalT = tSchema.nullable().optional();
  const timestampSchema = z.string().min(1);
  const optionalTimestamp = timestampSchema.nullable().optional();
  const payloadObjectSchema = z.record(z.string(), z.unknown());

  const ownerScopeSchema = z.object({
    ownerKind: z.enum(['user', 'team']),
    ownerId: uuidSchema,
  }).strict();

  const collectionSchema = z.string()
    .regex(collectionNamePattern, 'collection must be camelCase without underscores');

  const codecMetadataSchema = z.object({
    codec: z.literal('json').default('json'),
    encryptionMode: z.literal('none').default('none'),
    schemaVersion: z.number().int().positive(),
  }).strict();

  const syncObjectSchema = ownerScopeSchema.extend({
    id: uuidV7Schema,
    collection: collectionSchema,
    createdT: tSchema,
    changedT: tSchema,
    deletedT: optionalT,
    createdAt: timestampSchema,
    changedAt: timestampSchema,
    deletedAt: optionalTimestamp,
    codec: z.literal('json').default('json'),
    encryptionMode: z.literal('none').default('none'),
    payloadJson: payloadObjectSchema,
    payloadBytes: z.null().optional(),
    payloadHash: z.string().min(1),
    schemaVersion: z.number().int().positive(),
  }).strict().superRefine((value, ctx) => {
    if (value.changedT < value.createdT) {
      ctx.addIssue({
        code: 'custom',
        message: 'changedT must be greater than or equal to createdT',
        path: ['changedT'],
      });
    }
    if (value.deletedT != null && value.deletedT < value.changedT) {
      ctx.addIssue({
        code: 'custom',
        message: 'deletedT must be greater than or equal to changedT',
        path: ['deletedT'],
      });
    }
  });

  const syncTransactionSchema = z.object({
    t: tSchema,
    replicaEpoch: uuidSchema,
    actorUserId: uuidSchema.nullable().optional(),
    actorEmail: z.string().email().nullable().optional(),
    actorDeviceId: z.string().min(1).nullable().optional(),
    source: z.enum(['syncPush', 'system', 'import', 'repair']),
    createdAt: timestampSchema,
  }).strict();

  const syncIntentSchema = ownerScopeSchema.extend({
    id: uuidV7Schema,
    collection: collectionSchema,
    action: z.string().regex(collectionNamePattern, 'action must be camelCase without underscores'),
    objectId: uuidV7Schema.nullable().optional(),
    baseObjectT: optionalT,
    payloadJson: payloadObjectSchema.default({}),
    payloadHash: z.string().min(1).nullable().optional(),
    createdAt: timestampSchema,
  }).strict();

  const pullRequestSchema = z.object({
    replicaEpoch: uuidSchema,
    sinceT: tSchema.default(0),
    limit: z.number().int().positive().max(1000).optional(),
  }).strict();

  const pullResponseSchema = z.object({
    replicaEpoch: uuidSchema,
    fromT: tSchema,
    toT: tSchema,
    hasMore: z.boolean(),
    objects: z.array(syncObjectSchema),
  }).strict().superRefine((value, ctx) => {
    if (value.toT < value.fromT) {
      ctx.addIssue({
        code: 'custom',
        message: 'toT must be greater than or equal to fromT',
        path: ['toT'],
      });
    }
  });

  const pushRequestSchema = z.object({
    replicaEpoch: uuidSchema,
    baseT: tSchema,
    intents: z.array(syncIntentSchema),
  }).strict();

  const intentResultSchema = z.object({
    intentId: uuidV7Schema,
    status: z.enum(['accepted', 'idempotent', 'conflict', 'rejected']),
    t: optionalT,
    objectId: uuidV7Schema.nullable().optional(),
    reason: z.string().nullable().optional(),
  }).strict();

  const pushResponseSchema = z.object({
    replicaEpoch: uuidSchema,
    baseT: tSchema,
    toT: tSchema,
    results: z.array(intentResultSchema),
    objects: z.array(syncObjectSchema).default([]),
  }).strict();

  return {
    uuidSchema,
    uuidV7Schema,
    ownerScopeSchema,
    collectionSchema,
    codecMetadataSchema,
    syncObjectSchema,
    syncTransactionSchema,
    syncIntentSchema,
    pullRequestSchema,
    pullResponseSchema,
    pushRequestSchema,
    intentResultSchema,
    pushResponseSchema,
  };
}

export function createLocalReplicaParsers(z) {
  const schemas = buildLocalReplicaSchemas(z);
  return {
    schemas,
    parseSyncObject: payload =>
      parseWithSchema(schemas.syncObjectSchema, payload, 'Invalid Local Replica Sync Object'),
    parseSyncTransaction: payload =>
      parseWithSchema(schemas.syncTransactionSchema, payload, 'Invalid Local Replica Sync Transaction'),
    parseSyncIntent: payload =>
      parseWithSchema(schemas.syncIntentSchema, payload, 'Invalid Local Replica Sync Intent'),
    parsePullRequest: payload =>
      parseWithSchema(schemas.pullRequestSchema, payload, 'Invalid Local Replica pull request'),
    parsePullResponse: payload =>
      parseWithSchema(schemas.pullResponseSchema, payload, 'Invalid Local Replica pull response'),
    parsePushRequest: payload =>
      parseWithSchema(schemas.pushRequestSchema, payload, 'Invalid Local Replica push request'),
    parsePushResponse: payload =>
      parseWithSchema(schemas.pushResponseSchema, payload, 'Invalid Local Replica push response'),
  };
}
