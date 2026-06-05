import { z } from 'zod';
import {
  buildLocalCaptureSchemas,
  createLocalCaptureParsers,
  normalizeLegacyLocalCaptureRecord,
} from '../../../shared/contracts/localCapture.js';

export const localCaptureSchemas = buildLocalCaptureSchemas(z);
export const {
  parseLocalCaptureInput,
  parseLocalCaptureRecord,
  parseLocalCaptureUpdate,
  parseEntryFromCaptureInput,
} = createLocalCaptureParsers(z);
export { normalizeLegacyLocalCaptureRecord };
