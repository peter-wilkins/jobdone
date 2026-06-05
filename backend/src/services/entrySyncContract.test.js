import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { parseEntrySyncPayload } from '../contracts/entrySync.js';

describe('Entry sync contract', () => {
  test('accepts canonical entryData payloads', () => {
    const result = parseEntrySyncPayload({
      entryData: {
        id: 'entry-local-1',
        captureId: null,
        transcript: 'Fixed a dripping tap',
        summary: 'Fixed a dripping tap.',
        createdAt: '2026-05-17T01:00:00.000Z',
        contextClues: [],
        locations: [{ id: 'location-local-1', displayName: '14 Bell Street' }],
        contacts: [],
        tags: [],
        attachments: [],
      },
    });

    assert.equal(result.success, true);
    assert.equal(result.data.entryData.createdAt, '2026-05-17T01:00:00.000Z');
  });

  test('rejects old API field names loudly', () => {
    const result = parseEntrySyncPayload({
      entryData: {
        summary: 'Fixed a dripping tap.',
        createdAt: '2026-05-17T01:00:00.000Z',
        created_at: '2026-05-17T01:00:00.000Z',
      },
    });

    assert.equal(result.success, false);
    assert.equal(result.error, 'Use entryData.createdAt, not entryData.created_at');
  });
});
