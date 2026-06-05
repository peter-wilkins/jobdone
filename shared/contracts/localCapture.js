const legacyCaptureFieldReplacements = {
  created_at: 'createdAt',
  updated_at: 'updatedAt',
};

const legacyEntryFromCaptureFieldReplacements = {
  created_at: 'createdAt',
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

function legacyFieldErrors(row = {}, replacements = {}, prefix = 'capture') {
  if (!row || typeof row !== 'object' || Array.isArray(row)) return [];

  return Object.entries(replacements)
    .filter(([oldName]) => Object.prototype.hasOwnProperty.call(row, oldName))
    .map(([oldName, newName]) => `Use ${prefix}.${newName}, not ${prefix}.${oldName}`);
}

function parseWithLegacyCheck({ schema, payload, replacements, prefix, fallbackError }) {
  const legacyErrors = legacyFieldErrors(payload, replacements, prefix);
  if (legacyErrors.length) {
    return {
      success: false,
      error: legacyErrors[0],
      errors: legacyErrors,
    };
  }
  return parseWithSchema(schema, payload, fallbackError);
}

export function normalizeLegacyLocalCaptureRecord(capture = {}) {
  if (!capture || typeof capture !== 'object' || Array.isArray(capture)) return capture;
  const normalized = { ...capture };
  if ('created_at' in normalized && !('createdAt' in normalized)) normalized.createdAt = normalized.created_at;
  if ('updated_at' in normalized && !('updatedAt' in normalized)) normalized.updatedAt = normalized.updated_at;
  delete normalized.created_at;
  delete normalized.updated_at;
  return normalized;
}

export function buildLocalCaptureSchemas(z) {
  const looseObjectSchema = z.record(z.string(), z.unknown());
  const optionalString = z.string().nullable().optional();

  const localCaptureInputSchema = z.object({
    source: z.string().optional().default('manual'),
    kind: z.string().optional().default('entry'),
    payloads: z.array(looseObjectSchema).min(1, 'capture.payloads required'),
    status: z.string().optional().default('ready_for_review'),
    errorMessage: optionalString,
    devSignal: looseObjectSchema.optional(),
  }).strict();

  const localCaptureUpdateSchema = localCaptureInputSchema.partial().strict();

  const localCaptureRecordSchema = z.object({
    id: z.string().min(1, 'capture.id required'),
    source: z.string().min(1, 'capture.source required'),
    kind: z.string().min(1, 'capture.kind required'),
    payloads: z.array(looseObjectSchema).min(1, 'capture.payloads required'),
    status: z.string().min(1, 'capture.status required'),
    errorMessage: optionalString,
    devSignal: looseObjectSchema.optional(),
    createdAt: z.string().min(1, 'capture.createdAt required'),
    updatedAt: z.string().min(1, 'capture.updatedAt required'),
  }).strict();

  const entryFromCaptureInputSchema = z.object({
    captureId: z.string().min(1, 'captureId required'),
    transcript: z.string().optional().default(''),
    summary: z.string().optional().default(''),
    createdAt: z.string().optional(),
    locations: z.array(looseObjectSchema).default([]),
    contacts: z.array(looseObjectSchema).default([]),
    tags: z.array(looseObjectSchema).default([]),
    attachments: z.array(looseObjectSchema).default([]),
  }).strict();

  return {
    localCaptureInputSchema,
    localCaptureRecordSchema,
    localCaptureUpdateSchema,
    entryFromCaptureInputSchema,
  };
}

export function createLocalCaptureParsers(z) {
  const schemas = buildLocalCaptureSchemas(z);
  return {
    schemas,
    parseLocalCaptureInput: payload =>
      parseWithLegacyCheck({
        schema: schemas.localCaptureInputSchema,
        payload,
        replacements: legacyCaptureFieldReplacements,
        prefix: 'capture',
        fallbackError: 'Invalid local Capture input',
      }),
    parseLocalCaptureRecord: payload =>
      parseWithLegacyCheck({
        schema: schemas.localCaptureRecordSchema,
        payload,
        replacements: legacyCaptureFieldReplacements,
        prefix: 'capture',
        fallbackError: 'Invalid local Capture record',
      }),
    parseLocalCaptureUpdate: payload =>
      parseWithLegacyCheck({
        schema: schemas.localCaptureUpdateSchema,
        payload,
        replacements: legacyCaptureFieldReplacements,
        prefix: 'capture',
        fallbackError: 'Invalid local Capture update',
      }),
    parseEntryFromCaptureInput: payload =>
      parseWithLegacyCheck({
        schema: schemas.entryFromCaptureInputSchema,
        payload,
        replacements: legacyEntryFromCaptureFieldReplacements,
        prefix: 'entryFromCapture',
        fallbackError: 'Invalid Entry-from-Capture input',
      }),
  };
}
