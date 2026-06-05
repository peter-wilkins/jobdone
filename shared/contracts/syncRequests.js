const legacyContactFieldReplacements = {
  created_at: 'createdAt',
  updated_at: 'updatedAt',
  synced_at: 'syncedAt',
  display_name: 'displayName',
  primary_phone: 'primaryPhone',
  primary_email: 'primaryEmail',
  source_capture_ids: 'sourceCaptureIds',
  normalized_phones: 'normalizedPhones',
  normalized_emails: 'normalizedEmails',
  identity_keys: 'identityKeys',
  content_hash: 'contentHash',
};

const legacyLocationFieldReplacements = {
  created_at: 'createdAt',
  updated_at: 'updatedAt',
  synced_at: 'syncedAt',
  local_id: 'localId',
  display_name: 'displayName',
  place_text: 'placeText',
  address_text: 'addressText',
  provider_place_id: 'providerPlaceId',
};

function parseWithSchema(schema, payload, fallbackError) {
  const result = schema.safeParse(payload);
  if (result.success) return { success: true, data: result.data };

  const errors = result.error.issues.map(issue => issue.message);
  return {
    success: false,
    error: errors[0] || fallbackError,
    errors,
  };
}

function legacyFieldErrors(rows = [], replacements = {}, prefix = 'payload.items') {
  if (!Array.isArray(rows)) return [];
  const errors = [];
  rows.forEach((row, index) => {
    if (!row || typeof row !== 'object' || Array.isArray(row)) return;
    for (const [oldName, newName] of Object.entries(replacements)) {
      if (Object.prototype.hasOwnProperty.call(row, oldName)) {
        errors.push(`Use ${prefix}.${index}.${newName}, not ${prefix}.${index}.${oldName}`);
      }
    }
  });
  return errors;
}

function parseWithLegacyCheck({ schema, payload, rows, replacements, prefix, fallbackError }) {
  const legacyErrors = legacyFieldErrors(rows, replacements, prefix);
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
export function buildSyncRequestSchemas(z) {
  const optionalString = z.string().nullable().optional();
  const optionalNumber = z.number().nullable().optional();
  const contactValueSchema = z.record(z.string(), z.unknown());

  const contactRequestSchema = z.object({
    id: optionalString,
    localId: optionalString,
    remoteId: optionalString,
    clientId: optionalString,
    status: z.string().optional().default('confirmed'),
    displayName: z.string().optional().default(''),
    givenName: z.string().optional().default(''),
    familyName: z.string().optional().default(''),
    organization: z.string().optional().default(''),
    title: z.string().optional().default(''),
    note: z.string().optional().default(''),
    phones: z.array(contactValueSchema).default([]),
    emails: z.array(contactValueSchema).default([]),
    normalizedPhones: z.array(z.string()).default([]),
    normalizedEmails: z.array(z.string()).default([]),
    primaryPhone: optionalString,
    primaryEmail: optionalString,
    sourceCaptureIds: z.array(z.string()).default([]),
    contentHash: optionalString,
    identityKeys: z.array(z.string()).default([]),
    createdAt: optionalString,
    updatedAt: optionalString,
  }).strict();

  const contactsPayloadSchema = z.object({
    contacts: z.array(contactRequestSchema).default([]),
  }).strict();

  const contactPullPayloadSchema = z.object({
    clientIds: z.array(z.string()).default([]),
  }).strict();

  const locationRequestSchema = z.object({
    id: optionalString,
    status: z.string().optional().default('confirmed'),
    displayName: z.string(),
    placeText: z.string().optional().default(''),
    addressText: z.string().optional().default(''),
    latitude: optionalNumber,
    longitude: optionalNumber,
    providerPlaceId: optionalString,
    createdAt: optionalString,
    updatedAt: optionalString,
  }).strict();

  const locationsPayloadSchema = z.object({
    locations: z.array(locationRequestSchema).default([]),
  }).strict();

  return {
    contactRequestSchema,
    contactsPayloadSchema,
    contactPullPayloadSchema,
    locationRequestSchema,
    locationsPayloadSchema,
  };
}

export function createSyncRequestParsers(z) {
  const schemas = buildSyncRequestSchemas(z);
  return {
    schemas,
    parseContactsPayload: payload =>
      parseWithLegacyCheck({
        schema: schemas.contactsPayloadSchema,
        payload,
        rows: payload?.contacts,
        replacements: legacyContactFieldReplacements,
        prefix: 'contacts',
        fallbackError: 'Invalid contacts sync payload',
      }),
    parseContactPullPayload: payload =>
      parseWithSchema(schemas.contactPullPayloadSchema, payload, 'Invalid contact pull payload'),
    parseLocationsPayload: payload =>
      parseWithLegacyCheck({
        schema: schemas.locationsPayloadSchema,
        payload,
        rows: payload?.locations,
        replacements: legacyLocationFieldReplacements,
        prefix: 'locations',
        fallbackError: 'Invalid locations sync payload',
      }),
  };
}
