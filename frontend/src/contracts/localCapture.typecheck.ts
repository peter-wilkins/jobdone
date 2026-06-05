import type { z } from 'zod';
import { localCaptureSchemas } from './localCapture.js';

type LocalCaptureInput = z.input<typeof localCaptureSchemas.localCaptureInputSchema>;
type LocalCaptureRecord = z.infer<typeof localCaptureSchemas.localCaptureRecordSchema>;
type LocalCaptureUpdateInput = z.input<typeof localCaptureSchemas.localCaptureUpdateSchema>;
type EntryFromCaptureInput = z.input<typeof localCaptureSchemas.entryFromCaptureInputSchema>;

const captureInput: LocalCaptureInput = {
  source: 'share_target',
  kind: 'entry',
  payloads: [{ type: 'text', text: 'Fixed tap' }],
  status: 'ready_for_review',
  errorMessage: null,
  devSignal: { route: 'share-target' },
};

const captureInputWithLegacyTimestamp: LocalCaptureInput = {
  payloads: [{ type: 'text', text: 'Fixed tap' }],
  // @ts-expect-error createdAt/updatedAt are record fields, not local Capture input fields.
  created_at: '2026-06-05T12:00:00.000Z',
};

const captureRecord: LocalCaptureRecord = {
  id: 'capture-local-1',
  source: 'share_target',
  kind: 'entry',
  payloads: [{ type: 'text', text: 'Fixed tap' }],
  status: 'ready_for_review',
  errorMessage: null,
  createdAt: '2026-06-05T12:00:00.000Z',
  updatedAt: '2026-06-05T12:00:00.000Z',
};

const captureRecordWithLegacyTimestamp: LocalCaptureRecord = {
  id: 'capture-local-1',
  source: 'share_target',
  kind: 'entry',
  payloads: [{ type: 'text', text: 'Fixed tap' }],
  status: 'ready_for_review',
  createdAt: '2026-06-05T12:00:00.000Z',
  updatedAt: '2026-06-05T12:00:00.000Z',
  // @ts-expect-error createdAt is the canonical local Capture record field.
  created_at: '2026-06-05T12:00:00.000Z',
};

const captureUpdate: LocalCaptureUpdateInput = {
  status: 'ready_for_review',
  payloads: [{ type: 'text', text: 'Updated text' }],
};

const captureUpdateWithLegacyTimestamp: LocalCaptureUpdateInput = {
  status: 'ready_for_review',
  // @ts-expect-error updatedAt is not written through legacy snake_case.
  updated_at: '2026-06-05T12:01:00.000Z',
};

const entryFromCapture: EntryFromCaptureInput = {
  captureId: 'capture-local-1',
  transcript: 'Shared note',
  summary: 'Shared note',
  createdAt: '2026-06-05T12:00:00.000Z',
  locations: [{ id: 'location-local-1', displayName: '14 Bell Street' }],
  contacts: [{ id: 'contact-local-1', displayName: 'Ann Smith' }],
  tags: [{ id: 'tag-local-1', label: 'Boiler Service' }],
  attachments: [],
};

const entryFromCaptureWithLegacyCreatedAt: EntryFromCaptureInput = {
  captureId: 'capture-local-1',
  summary: 'Shared note',
  // @ts-expect-error createdAt is the canonical Entry-from-Capture timestamp.
  created_at: '2026-06-05T12:00:00.000Z',
};

const entryFromCaptureWithLegacySnapshots: EntryFromCaptureInput = {
  captureId: 'capture-local-1',
  summary: 'Shared note',
  // @ts-expect-error locations is the canonical Entry-from-Capture field.
  locationSnapshots: [{ id: 'location-local-1' }],
};

void captureInput;
void captureInputWithLegacyTimestamp;
void captureRecord;
void captureRecordWithLegacyTimestamp;
void captureUpdate;
void captureUpdateWithLegacyTimestamp;
void entryFromCapture;
void entryFromCaptureWithLegacyCreatedAt;
void entryFromCaptureWithLegacySnapshots;
