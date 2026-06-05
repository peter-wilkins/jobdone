import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseContactRow,
  parseEntryRow,
  parseLocationRow,
} from '../contracts/databaseRows.js';

describe('Database row contracts', () => {
  test('accepts current JobDone database row shapes', () => {
    assert.equal(parseEntryRow({
      id: 'entry-cloud-1',
      user_id: 'user-1',
      capture_id: 'capture-local-1',
      transcript: 'Fixed tap',
      summary: 'Fixed tap summary',
      embedding: '[0.1,0.2]',
      embedding_model: 'voyage-3-lite',
      created_at: new Date('2026-06-05T12:00:00.000Z'),
      synced_at: '2026-06-05T12:01:00.000Z',
      recall_score: 0.75,
      match_reasons: ['summary'],
    }).success, true);

    assert.equal(parseLocationRow({
      id: 'location-cloud-1',
      user_id: 'user-1',
      local_id: 'location-local-1',
      display_name: '14 Bell Street',
      place_text: 'Workshop',
      address_text: '14 Bell Street, Testville',
      latitude: 51.5,
      longitude: -0.1,
      provider_place_id: 'google-place-1',
      created_at: '2026-06-05T12:00:00.000Z',
      updated_at: new Date('2026-06-05T12:01:00.000Z'),
    }).success, true);

    assert.equal(parseContactRow({
      id: 'contact-cloud-1',
      userId: 'user-1',
      clientId: 'contact-local-1',
      displayName: 'Ann Smith',
      normalizedPhones: ['+441234567890'],
      sourceCaptureIds: ['capture-local-1'],
      createdAt: '2026-06-05T12:00:00.000Z',
      updatedAt: new Date('2026-06-05T12:01:00.000Z'),
    }).success, true);
  });

  test('rejects app-shape fields at database row seams', () => {
    assert.equal(parseEntryRow({
      id: 'entry-cloud-1',
      summary: 'Fixed tap summary',
      createdAt: '2026-06-05T12:00:00.000Z',
    }).success, false);

    assert.equal(parseLocationRow({
      id: 'location-cloud-1',
      displayName: '14 Bell Street',
    }).success, false);

    assert.equal(parseContactRow({
      id: 'contact-cloud-1',
      display_name: 'Ann Smith',
    }).success, false);
  });
});
