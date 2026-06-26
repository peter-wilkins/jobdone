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
export function buildWaterWalkDatasetSchemas(z) {
  const latLonSchema = z.tuple([
    z.number().min(-90).max(90),
    z.number().min(-180).max(180),
  ]);

  const candidateSchema = z.object({
    id: z.string().min(1),
    title: z.string().min(1),
    latitude: z.number().min(-90).max(90),
    longitude: z.number().min(-180).max(180),
    priority: z.enum(['high', 'medium', 'low', 'background']),
    score: z.number(),
    whyInteresting: z.array(z.string()).default([]),
    lookFor: z.array(z.string()).default([]),
    evidencePrompt: z.string().default('Take photos and notes that explain what you found.'),
  }).strict();

  const areaSchema = z.object({
    id: z.string().min(1),
    title: z.string().min(1),
    sourceFieldName: z.string().min(1),
    areaType: z.enum(['clay_rich_texture_class', 'context']).default('context'),
    priority: z.string().default('context'),
    soilTextureCode: z.string().nullable().default(null),
    soilTextureLabel: z.string().nullable().default(null),
    numericClayPercent: z.number().nullable().default(null),
    confidence: z.enum(['low', 'medium', 'high']).default('low'),
    note: z.string().default(''),
    rings: z.array(z.array(latLonSchema).min(3)).min(1),
    centre: latLonSchema.nullable().default(null),
  }).strict();

  const datasetSchema = z.object({
    projectId: z.string().min(1).default('dewlish-water-walk'),
    generatedAt: z.string().nullable().optional(),
    sourceNotes: z.array(z.string()).default([]),
    candidates: z.array(candidateSchema).default([]),
    areas: z.array(areaSchema).default([]),
    unmappedClayRichFields: z.array(z.string()).default([]),
  }).strict();

  return {
    waterWalkCandidateSchema: candidateSchema,
    waterWalkAreaSchema: areaSchema,
    waterWalkDatasetSchema: datasetSchema,
  };
}

export function createWaterWalkDatasetParsers(z) {
  const schemas = buildWaterWalkDatasetSchemas(z);
  return {
    schemas,
    parseWaterWalkDataset: payload =>
      parseWithSchema(schemas.waterWalkDatasetSchema, payload, 'Invalid Water Walk dataset'),
  };
}
