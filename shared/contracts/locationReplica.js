import { isUuidV7 } from './clientId.js';

const legacyLocationFieldReplacements = {
  localId: 'id',
  local_id: 'id',
  remoteId: 'backend-private',
  remote_id: 'backend-private',
  serverId: 'backend-private',
  server_id: 'backend-private',
  userId: 'backend-derived',
  user_id: 'backend-derived',
  display_name: 'displayName',
  place_text: 'placeText',
  address_text: 'addressText',
  accuracy_meters: 'accuracyMeters',
  provider_place_id: 'providerPlaceId',
  content_hash: 'contentHash',
  created_at: 'createdAt',
  updated_at: 'updatedAt',
};

function formatIssue(issue) {
  if (issue.code === 'unrecognized_keys') {
    const keys = Array.isArray(issue.keys) ? issue.keys.join(', ') : 'unknown';
    const path = issue.path?.length ? issue.path.join('.') : 'payload';
    return `${path} has unrecognized field(s): ${keys}`;
  }
  return issue.message;
}

function parseWithSchema(schema, payload, fallbackError) {
  const result = schema.safeParse(payload);
  if (result.success) return { success: true, data: result.data };

  const errors = result.error.issues.map(formatIssue);
  return {
    success: false,
    error: errors[0] || fallbackError,
    errors,
  };
}

function legacyFieldErrors(rows = [], prefix = 'locations') {
  if (!Array.isArray(rows)) return [];
  const errors = [];
  rows.forEach((row, index) => {
    if (!row || typeof row !== 'object' || Array.isArray(row)) return;
    for (const [oldName, newName] of Object.entries(legacyLocationFieldReplacements)) {
      if (Object.prototype.hasOwnProperty.call(row, oldName)) {
        errors.push(newName === 'backend-private' || newName === 'backend-derived'
          ? `${prefix}.${index}.${oldName} must not cross the Location Replica API`
          : `Use ${prefix}.${index}.${newName}, not ${prefix}.${index}.${oldName}`);
      }
    }
  });
  return errors;
}

function parseWithLegacyCheck({ schema, payload, rows, prefix, fallbackError }) {
  const legacyErrors = legacyFieldErrors(rows, prefix);
  if (legacyErrors.length) {
    return {
      success: false,
      error: legacyErrors[0],
      errors: legacyErrors,
    };
  }
  return parseWithSchema(schema, payload, fallbackError);
}

/**
 * @param {typeof import('zod').z} z
 */
export function buildLocationReplicaSchemas(z) {
  const optionalString = z.string().nullable().optional();
  const optionalNumber = z.number().nullable().optional();
  const uuidV7Schema = z.string().refine(isUuidV7, 'id must be a UUIDv7 Client ID');
  const statusSchema = z.enum(['active', 'archived']).default('active');

  const locationReplicaRecordSchema = z.object({
    id: uuidV7Schema,
    status: statusSchema,
    displayName: z.string().min(1, 'displayName required'),
    placeText: z.string().optional().default(''),
    addressText: z.string().optional().default(''),
    latitude: optionalNumber,
    longitude: optionalNumber,
    accuracyMeters: optionalNumber,
    providerPlaceId: optionalString,
    contentHash: optionalString,
    createdAt: optionalString,
    updatedAt: optionalString,
  }).strict();

  const locationReplicaManifestRowSchema = z.object({
    id: uuidV7Schema,
    status: statusSchema,
    contentHash: z.string().min(1, 'contentHash required'),
    identityKeys: z.array(z.string()).default([]),
    updatedAt: optionalString,
  }).strict();

  const locationReplicaAliasSchema = z.object({
    collection: z.literal('locations').default('locations'),
    fromClientId: uuidV7Schema,
    toClientId: uuidV7Schema,
    reason: z.string().min(1),
  }).strict();

  const locationReplicaManifestRequestSchema = z.object({
    locations: z.array(locationReplicaManifestRowSchema).default([]),
  }).strict();

  const locationReplicaManifestResponseSchema = z.object({
    success: z.literal(true),
    locations: z.array(locationReplicaManifestRowSchema),
    aliases: z.array(locationReplicaAliasSchema).default([]),
  }).strict();

  const locationReplicaPushRequestSchema = z.object({
    locations: z.array(locationReplicaRecordSchema).default([]),
  }).strict();

  const locationReplicaPullRequestSchema = z.object({
    ids: z.array(uuidV7Schema).default([]),
  }).strict();

  const locationReplicaRecordsResponseSchema = z.object({
    success: z.literal(true),
    locations: z.array(locationReplicaRecordSchema),
    aliases: z.array(locationReplicaAliasSchema).default([]),
  }).strict();

  return {
    locationReplicaRecordSchema,
    locationReplicaManifestRowSchema,
    locationReplicaAliasSchema,
    locationReplicaManifestRequestSchema,
    locationReplicaManifestResponseSchema,
    locationReplicaPushRequestSchema,
    locationReplicaPullRequestSchema,
    locationReplicaRecordsResponseSchema,
  };
}

export function createLocationReplicaParsers(z) {
  const schemas = buildLocationReplicaSchemas(z);
  return {
    schemas,
    parseLocationReplicaManifestRequest: payload =>
      parseWithLegacyCheck({
        schema: schemas.locationReplicaManifestRequestSchema,
        payload,
        rows: payload?.locations,
        prefix: 'locations',
        fallbackError: 'Invalid Location Replica manifest request',
      }),
    parseLocationReplicaManifestResponse: payload =>
      parseWithLegacyCheck({
        schema: schemas.locationReplicaManifestResponseSchema,
        payload,
        rows: payload?.locations,
        prefix: 'locations',
        fallbackError: 'Invalid Location Replica manifest response',
      }),
    parseLocationReplicaPushRequest: payload =>
      parseWithLegacyCheck({
        schema: schemas.locationReplicaPushRequestSchema,
        payload,
        rows: payload?.locations,
        prefix: 'locations',
        fallbackError: 'Invalid Location Replica push request',
      }),
    parseLocationReplicaPullRequest: payload =>
      parseWithSchema(schemas.locationReplicaPullRequestSchema, payload, 'Invalid Location Replica pull request'),
    parseLocationReplicaRecordsResponse: payload =>
      parseWithLegacyCheck({
        schema: schemas.locationReplicaRecordsResponseSchema,
        payload,
        rows: payload?.locations,
        prefix: 'locations',
        fallbackError: 'Invalid Location Replica records response',
      }),
  };
}
