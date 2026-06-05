export const legacyEntrySyncFieldReplacements = {
  created_at: 'createdAt',
  capture_id: 'captureId',
  context_clues: 'contextClues',
  locationSnapshots: 'locations',
  contactSnapshots: 'contacts',
  tagSnapshots: 'tags',
  attachmentSnapshots: 'attachments',
};

export function buildEntrySyncPayloadSchema(z) {
  const looseObjectSchema = z.record(z.string(), z.unknown());

  return z.object({
    entryData: z.object({
      id: z.string().optional(),
      captureId: z.string().nullable().optional(),
      transcript: z.string().nullable().optional(),
      summary: z.string().min(1, 'entryData.summary required'),
      createdAt: z.string().min(1, 'entryData.createdAt required'),
      contextClues: z.array(looseObjectSchema).default([]),
      locations: z.array(looseObjectSchema).default([]),
      contacts: z.array(looseObjectSchema).default([]),
      tags: z.array(looseObjectSchema).default([]),
      attachments: z.array(looseObjectSchema).default([]),
    }).strict(),
  }).strict();
}

function formatPath(path = []) {
  return path.length ? path.join('.') : 'payload';
}

function formatIssue(issue) {
  if (issue.code === 'unrecognized_keys') {
    const keys = Array.isArray(issue.keys) ? issue.keys.join(', ') : 'unknown';
    return `${formatPath(issue.path)} has unrecognized field(s): ${keys}`;
  }
  return issue.message;
}

export function legacyEntrySyncFieldErrors(entryData = {}) {
  if (!entryData || typeof entryData !== 'object' || Array.isArray(entryData)) return [];

  return Object.entries(legacyEntrySyncFieldReplacements)
    .filter(([oldName]) => Object.prototype.hasOwnProperty.call(entryData, oldName))
    .map(([oldName, newName]) => `Use entryData.${newName}, not entryData.${oldName}`);
}

export function parseEntrySyncPayloadWithSchema(entrySyncPayloadSchema, payload) {
  const legacyErrors = legacyEntrySyncFieldErrors(payload?.entryData);
  if (legacyErrors.length) {
    return {
      success: false,
      error: legacyErrors[0],
      errors: legacyErrors,
    };
  }

  const result = entrySyncPayloadSchema.safeParse(payload);
  if (result.success) {
    return { success: true, data: result.data };
  }

  const errors = result.error.issues.map(formatIssue);
  return {
    success: false,
    error: errors[0] || 'Invalid entry sync payload',
    errors,
  };
}

export function createEntrySyncParser(z) {
  const entrySyncPayloadSchema = buildEntrySyncPayloadSchema(z);
  return payload => parseEntrySyncPayloadWithSchema(entrySyncPayloadSchema, payload);
}
