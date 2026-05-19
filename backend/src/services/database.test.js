import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { buildContactLocationCooccurrences } from './database.js';

describe('Database co-occurrence derivation', () => {
  test('derives Contact-Location counts from confirmed Entry links', () => {
    const rows = buildContactLocationCooccurrences([
      {
        entry_id: 'entry-1',
        created_at: '2026-05-17T10:00:00.000Z',
        contacts: { id: 'contact-1', display_name: 'Sarah Jenkins' },
      },
      {
        entry_id: 'entry-2',
        created_at: '2026-05-18T10:00:00.000Z',
        contacts: { id: 'contact-1', display_name: 'Sarah Jenkins' },
      },
      {
        entry_id: 'entry-3',
        created_at: '2026-05-18T11:00:00.000Z',
        contacts: { id: 'contact-2', display_name: 'Ann Smith' },
      },
    ], [
      {
        entry_id: 'entry-1',
        created_at: '2026-05-17T10:05:00.000Z',
        locations: { id: 'loc-1', display_name: '14 Bell Street', place_text: '14 Bell Street' },
      },
      {
        entry_id: 'entry-2',
        created_at: '2026-05-18T10:05:00.000Z',
        locations: { id: 'loc-1', display_name: '14 Bell Street', place_text: '14 Bell Street' },
      },
      {
        entry_id: 'entry-3',
        created_at: '2026-05-18T11:05:00.000Z',
        locations: { id: 'loc-2', display_name: '22 King Road', place_text: '22 King Road' },
      },
    ]);

    assert.deepEqual(rows.sort((a, b) => a.contactId.localeCompare(b.contactId)), [
      {
        contactId: 'contact-1',
        contactLabel: 'Sarah Jenkins',
        locationId: 'loc-1',
        locationLabel: '14 Bell Street',
        locationPlaceText: '14 Bell Street',
        locationLatitude: undefined,
        locationLongitude: undefined,
        count: 2,
        lastSeenAt: '2026-05-18T10:05:00.000Z',
      },
      {
        contactId: 'contact-2',
        contactLabel: 'Ann Smith',
        locationId: 'loc-2',
        locationLabel: '22 King Road',
        locationPlaceText: '22 King Road',
        locationLatitude: undefined,
        locationLongitude: undefined,
        count: 1,
        lastSeenAt: '2026-05-18T11:05:00.000Z',
      },
    ]);
  });
});
