import { z } from 'zod';
import { buildEntrySyncPayloadSchema, createEntrySyncParser } from '../../../shared/contracts/entrySync.js';

export const entrySyncPayloadSchema = buildEntrySyncPayloadSchema(z);
export const parseEntrySyncPayload = createEntrySyncParser(z);
