import assert from 'node:assert/strict';
import test from 'node:test';
import {
  normalizeLegacyLocalCaptureRecord,
  parseEntryFromCaptureInput,
  parseLocalCaptureRecord,
} from '../contracts/localCapture.js';

test('local Capture records accept canonical timestamp fields', () => {
  const result = parseLocalCaptureRecord({
    id: 'capture-local-1',
    source: 'share_target',
    kind: 'entry',
    status: 'ready_for_review',
    errorMessage: null,
    payloads: [{ type: 'text', text: 'Fixed tap' }],
    createdAt: '2026-06-05T12:00:00.000Z',
    updatedAt: '2026-06-05T12:00:00.000Z',
  });

  assert.equal(result.success, true);
  assert.equal(result.data.createdAt, '2026-06-05T12:00:00.000Z');
});

test('local Capture records reject legacy timestamp fields loudly', () => {
  const result = parseLocalCaptureRecord({
    id: 'capture-local-1',
    source: 'share_target',
    kind: 'entry',
    status: 'ready_for_review',
    payloads: [{ type: 'text', text: 'Fixed tap' }],
    created_at: '2026-06-05T12:00:00.000Z',
    updated_at: '2026-06-05T12:00:00.000Z',
  });

  assert.equal(result.success, false);
  assert.equal(result.error, 'Use capture.createdAt, not capture.created_at');
});

test('legacy Capture rows can be normalized before read validation', () => {
  const normalized = normalizeLegacyLocalCaptureRecord({
    id: 'capture-local-1',
    source: 'share_target',
    kind: 'entry',
    status: 'ready_for_review',
    payloads: [{ type: 'text', text: 'Fixed tap' }],
    created_at: '2026-06-05T12:00:00.000Z',
    updated_at: '2026-06-05T12:01:00.000Z',
  });

  assert.equal(normalized.createdAt, '2026-06-05T12:00:00.000Z');
  assert.equal(normalized.updatedAt, '2026-06-05T12:01:00.000Z');
  assert.equal(Object.prototype.hasOwnProperty.call(normalized, 'created_at'), false);
  assert.equal(parseLocalCaptureRecord(normalized).success, true);
});

test('Entry-from-Capture input rejects legacy created_at', () => {
  const result = parseEntryFromCaptureInput({
    captureId: 'capture-local-1',
    transcript: 'Shared note',
    summary: 'Shared note',
    created_at: '2026-06-05T12:00:00.000Z',
  });

  assert.equal(result.success, false);
  assert.equal(result.error, 'Use entryFromCapture.createdAt, not entryFromCapture.created_at');
});
