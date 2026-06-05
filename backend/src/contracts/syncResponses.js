import { z } from 'zod';
import { buildSyncResponseSchemas, createSyncResponseParsers } from '../../../shared/contracts/syncResponses.js';

export const syncResponseSchemas = buildSyncResponseSchemas(z);
export const {
  parseEntrySaveResponse,
  parseEntriesResponse,
  parseContactsResponse,
  parseLocationsResponse,
} = createSyncResponseParsers(z);
