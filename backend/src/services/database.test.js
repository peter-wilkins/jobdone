import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildContactLocationCooccurrences,
  findReusableLocation,
  locationsHaveStrongIdentityMatch,
} from './database.js';

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

describe('Location identity matching', () => {
  test('matches exact normalized display labels', () => {
    const existing = { id: 'loc-1', display_name: '14 Bell Street' };
    const incoming = { displayName: '  14   bell street  ' };

    assert.equal(locationsHaveStrongIdentityMatch(existing, incoming), true);
    assert.equal(findReusableLocation([existing], incoming), existing);
  });

  test('matches postcode plus first address line', () => {
    assert.equal(locationsHaveStrongIdentityMatch(
      { display_name: '14 Bell Street', address_text: '14 Bell Street, London SW1A 1AA' },
      { displayName: 'Bell Street job', addressText: '14 Bell Street, SW1A1AA' }
    ), true);
  });

  test('matches provider place ids when present', () => {
    assert.equal(locationsHaveStrongIdentityMatch(
      { display_name: 'Old provider label', provider_place_id: 'places/abc123' },
      { displayName: 'New provider label', providerPlaceId: 'places/abc123' }
    ), true);
  });

  test('does not match nearby-looking but different labels without strong identity evidence', () => {
    assert.equal(locationsHaveStrongIdentityMatch(
      { display_name: '14 Bell Street', latitude: 51.5, longitude: -0.1 },
      { displayName: '16 Bell Street', latitude: 51.50001, longitude: -0.10001 }
    ), false);
  });
});
