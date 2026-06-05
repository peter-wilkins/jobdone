import { z } from 'zod';
import { buildSyncRequestSchemas, createSyncRequestParsers } from '../../../shared/contracts/syncRequests.js';

export const syncRequestSchemas = buildSyncRequestSchemas(z);
export const {
  parseContactsPayload,
  parseContactPullPayload,
  parseLocationsPayload,
} = createSyncRequestParsers(z);
