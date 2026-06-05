import { z } from 'zod';

const optionalString = z.string().nullable().optional();
const optionalNumber = z.number().nullable().optional();
const optionalTimestamp = z.union([z.string(), z.date()]).nullable().optional();
const looseObject = z.record(z.string(), z.unknown());

export const databaseRowSchemas = {
  entryRowSchema: z.object({
    id: z.string(),
    capture_id: optionalString,
    transcript: z.string().nullable().optional(),
    summary: z.string().nullable().optional(),
    created_at: optionalTimestamp,
    synced_at: optionalTimestamp,
  }).strict(),

  locationRowSchema: z.object({
    id: optionalString,
    local_id: optionalString,
    status: z.string().optional(),
    display_name: z.string().optional(),
    place_text: z.string().optional(),
    address_text: z.string().optional(),
    latitude: optionalNumber,
    longitude: optionalNumber,
    provider_place_id: optionalString,
    created_at: optionalTimestamp,
    updated_at: optionalTimestamp,
  }).strict(),

  contactRowSchema: z.object({
    id: optionalString,
    clientId: optionalString,
    status: z.string().optional(),
    displayName: z.string().optional(),
    givenName: z.string().optional(),
    familyName: z.string().optional(),
    organization: z.string().optional(),
    title: z.string().optional(),
    note: z.string().optional(),
    phones: z.array(looseObject).optional(),
    emails: z.array(looseObject).optional(),
    normalizedPhones: z.array(z.string()).optional(),
    normalizedEmails: z.array(z.string()).optional(),
    primaryPhone: optionalString,
    primaryEmail: optionalString,
    sourceCaptureIds: z.array(z.string()).optional(),
    contentHash: optionalString,
    identityKeys: z.array(z.string()).optional(),
    createdAt: optionalTimestamp,
    updatedAt: optionalTimestamp,
  }).strict(),
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

export const parseEntryRow = payload =>
  parseWithSchema(databaseRowSchemas.entryRowSchema, payload, 'Invalid Entry database row');

export const parseLocationRow = payload =>
  parseWithSchema(databaseRowSchemas.locationRowSchema, payload, 'Invalid Location database row');

export const parseContactRow = payload =>
  parseWithSchema(databaseRowSchemas.contactRowSchema, payload, 'Invalid Contact database row');
