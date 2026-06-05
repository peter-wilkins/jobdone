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

/**
 * @param {typeof import('zod').z} z
 */
export function buildSyncResponseSchemas(z) {
  const looseObjectSchema = z.record(z.string(), z.unknown());
  const optionalString = z.string().nullable().optional();
  const optionalNumber = z.number().nullable().optional();
  const optionalTimestamp = z.preprocess(value => {
    if (value instanceof Date && !Number.isNaN(value.valueOf())) {
      return value.toISOString();
    }
    return value;
  }, optionalString);

  const contextClueSchema = z.object({
    id: optionalString,
    remoteId: optionalString,
    kind: z.string(),
    source: z.string(),
    summary: z.string(),
    payload: looseObjectSchema.default({}),
    confidence: z.number().nullable().optional(),
    metadata: looseObjectSchema.default({}),
    createdAt: optionalTimestamp,
  }).strict();

  const locationSchema = z.object({
    id: optionalString,
    status: z.string().default('confirmed'),
    displayName: z.string(),
    placeText: z.string(),
    addressText: z.string(),
    latitude: optionalNumber,
    longitude: optionalNumber,
    providerPlaceId: optionalString,
    createdAt: optionalTimestamp,
    updatedAt: optionalTimestamp,
  }).strict();

  const contactSchema = z.object({
    id: optionalString,
    remoteId: optionalString,
    serverId: optionalString,
    clientId: optionalString,
    status: z.string().default('confirmed'),
    displayName: z.string(),
    givenName: z.string().optional().default(''),
    familyName: z.string().optional().default(''),
    organization: z.string().optional().default(''),
    title: z.string().optional().default(''),
    note: z.string().optional().default(''),
    phones: z.array(z.unknown()).default([]),
    emails: z.array(z.unknown()).default([]),
    normalizedPhones: z.array(z.string()).default([]),
    normalizedEmails: z.array(z.string()).default([]),
    primaryPhone: optionalString,
    primaryEmail: optionalString,
    sourceCaptureIds: z.array(z.string()).default([]),
    contentHash: optionalString,
    identityKeys: z.array(z.string()).default([]),
    createdAt: optionalTimestamp,
    updatedAt: optionalTimestamp,
  }).strict();

  const tagSchema = z.object({
    id: optionalString,
    remoteId: optionalString,
    label: z.string(),
    normalizedLabel: optionalString,
    categoryId: optionalString,
    categoryName: z.string(),
  }).strict();

  const attachmentSchema = z.object({
    id: optionalString,
    remoteId: optionalString,
    kind: z.string(),
    filename: z.string(),
    mimeType: z.string(),
    byteSize: z.number().nullable(),
    width: optionalNumber,
    height: optionalNumber,
    metadata: looseObjectSchema.default({}),
    createdAt: optionalTimestamp,
  }).strict();

  const entrySchema = z.object({
    id: z.string(),
    captureId: optionalString,
    transcript: z.string(),
    summary: z.string(),
    createdAt: optionalTimestamp,
    syncedAt: optionalTimestamp,
    contextClues: z.array(contextClueSchema).default([]),
    locations: z.array(locationSchema.omit({ providerPlaceId: true })).default([]),
    contacts: z.array(contactSchema.pick({
      id: true,
      remoteId: true,
      displayName: true,
      primaryPhone: true,
      primaryEmail: true,
    })).default([]),
    tags: z.array(tagSchema).default([]),
    attachments: z.array(attachmentSchema).default([]),
  }).strict();

  const aliasSchema = looseObjectSchema;

  return {
    entrySchema,
    entrySaveResponseSchema: z.object({
      success: z.literal(true),
      entry: entrySchema,
    }).strict(),
    entriesResponseSchema: z.object({
      success: z.literal(true),
      entries: z.array(entrySchema),
    }).strict(),
    contactSchema,
    contactsResponseSchema: z.object({
      success: z.literal(true),
      contacts: z.array(contactSchema),
      aliases: z.array(aliasSchema).optional(),
    }).strict(),
    locationSchema,
    locationsResponseSchema: z.object({
      success: z.literal(true),
      locations: z.array(locationSchema),
    }).strict(),
  };
}

export function createSyncResponseParsers(z) {
  const schemas = buildSyncResponseSchemas(z);
  return {
    schemas,
    parseEntrySaveResponse: payload =>
      parseWithSchema(schemas.entrySaveResponseSchema, payload, 'Invalid entry sync response'),
    parseEntriesResponse: payload =>
      parseWithSchema(schemas.entriesResponseSchema, payload, 'Invalid entries sync response'),
    parseContactsResponse: payload =>
      parseWithSchema(schemas.contactsResponseSchema, payload, 'Invalid contacts sync response'),
    parseLocationsResponse: payload =>
      parseWithSchema(schemas.locationsResponseSchema, payload, 'Invalid locations sync response'),
  };
}
