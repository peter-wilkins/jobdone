import type { z } from 'zod';
import { databaseRowSchemas } from './databaseRows.js';

type EntryRow = z.infer<typeof databaseRowSchemas.entryRowSchema>;
type LocationRow = z.infer<typeof databaseRowSchemas.locationRowSchema>;
type ContactRow = z.infer<typeof databaseRowSchemas.contactRowSchema>;

const entryRow: EntryRow = {
  id: 'entry-cloud-1',
  capture_id: 'capture-local-1',
  transcript: 'Fixed tap',
  summary: 'Fixed tap summary',
  created_at: '2026-06-05T12:00:00.000Z',
  synced_at: new Date('2026-06-05T12:01:00.000Z'),
};

const entryRowWithAppShape: EntryRow = {
  id: 'entry-cloud-1',
  summary: 'Fixed tap summary',
  // @ts-expect-error Entry DB rows use created_at until the entries table is converted.
  createdAt: '2026-06-05T12:00:00.000Z',
};

const locationRow: LocationRow = {
  id: 'location-cloud-1',
  local_id: 'location-local-1',
  status: 'confirmed',
  display_name: '14 Bell Street',
  place_text: 'Workshop',
  address_text: '14 Bell Street, Testville',
  latitude: 51.5,
  longitude: -0.1,
  provider_place_id: 'google-place-1',
  created_at: '2026-06-05T12:00:00.000Z',
  updated_at: '2026-06-05T12:01:00.000Z',
};

const locationRowWithAppShape: LocationRow = {
  id: 'location-cloud-1',
  // @ts-expect-error Location DB rows use display_name until the locations table is converted.
  displayName: '14 Bell Street',
};

const contactRow: ContactRow = {
  id: 'contact-cloud-1',
  clientId: 'contact-local-1',
  status: 'confirmed',
  displayName: 'Ann Smith',
  givenName: 'Ann',
  familyName: 'Smith',
  organization: '',
  title: '',
  note: '',
  phones: [{ value: '+441234567890', normalized: '+441234567890' }],
  emails: [],
  normalizedPhones: ['+441234567890'],
  normalizedEmails: [],
  primaryPhone: '+441234567890',
  primaryEmail: null,
  sourceCaptureIds: ['capture-local-1'],
  contentHash: 'hash-1',
  identityKeys: ['phone:+441234567890'],
  createdAt: '2026-06-05T12:00:00.000Z',
  updatedAt: new Date('2026-06-05T12:01:00.000Z'),
};

const contactRowWithLegacyShape: ContactRow = {
  id: 'contact-cloud-1',
  // @ts-expect-error Contact DB rows are camelCase quoted PostgreSQL identifiers.
  display_name: 'Ann Smith',
};

void entryRow;
void entryRowWithAppShape;
void locationRow;
void locationRowWithAppShape;
void contactRow;
void contactRowWithLegacyShape;
