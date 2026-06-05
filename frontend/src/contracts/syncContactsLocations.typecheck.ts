import type { z } from 'zod';
import { syncRequestSchemas } from './syncRequests.js';
import { syncResponseSchemas } from './syncResponses.js';
import { locationReplicaSchemas } from './locationReplica.js';

type ContactsPayloadInput = z.input<typeof syncRequestSchemas.contactsPayloadSchema>;
type ContactsResponse = z.infer<typeof syncResponseSchemas.contactsResponseSchema>;
type LocationReplicaPushInput = z.input<typeof locationReplicaSchemas.locationReplicaPushRequestSchema>;
type LocationReplicaRecordsResponse = z.infer<typeof locationReplicaSchemas.locationReplicaRecordsResponseSchema>;

const contactsPayload: ContactsPayloadInput = {
  contacts: [{
    id: 'contact-local-1',
    localId: 'contact-local-1',
    remoteId: null,
    clientId: 'contact-local-1',
    status: 'confirmed',
    displayName: 'Ann Smith',
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
    updatedAt: '2026-06-05T12:00:00.000Z',
  }],
};

const contactsPayloadWithLegacyField: ContactsPayloadInput = {
  contacts: [{
    displayName: 'Ann Smith',
    // @ts-expect-error displayName is the canonical field at the API boundary.
    display_name: 'Ann Smith',
  }],
};

const locationsPayload: LocationReplicaPushInput = {
  locations: [{
    id: '01973e36-4c80-7abc-8a72-111111111111',
    status: 'active',
    displayName: '14 Bell Street',
    placeText: 'Workshop',
    addressText: '14 Bell Street, Testville',
    latitude: 51.5,
    longitude: -0.1,
    providerPlaceId: 'google-place-1',
    contentHash: 'hash-a',
    createdAt: '2026-06-05T12:00:00.000Z',
    updatedAt: '2026-06-05T12:00:00.000Z',
  }],
};

const locationsPayloadWithLegacyField: LocationReplicaPushInput = {
  locations: [{
    id: '01973e36-4c80-7abc-8a72-111111111111',
    displayName: '14 Bell Street',
    // @ts-expect-error providerPlaceId is the canonical field at the API boundary.
    provider_place_id: 'google-place-1',
  }],
};

const contactsResponse: ContactsResponse = {
  success: true,
  contacts: [{
    id: 'contact-local-1',
    remoteId: 'contact-cloud-1',
    serverId: 'contact-cloud-1',
    clientId: 'contact-local-1',
    status: 'confirmed',
    displayName: 'Ann Smith',
    givenName: 'Ann',
    familyName: 'Smith',
    organization: '',
    title: '',
    note: '',
    phones: [],
    emails: [],
    normalizedPhones: [],
    normalizedEmails: [],
    primaryPhone: null,
    primaryEmail: null,
    sourceCaptureIds: [],
    contentHash: null,
    identityKeys: [],
    createdAt: '2026-06-05T12:00:00.000Z',
    updatedAt: '2026-06-05T12:00:00.000Z',
  }],
};

const contactsResponseWithLegacyField: ContactsResponse = {
  success: true,
  contacts: [{
    id: 'contact-local-1',
    remoteId: 'contact-cloud-1',
    displayName: 'Ann Smith',
    // @ts-expect-error createdAt is the canonical response field.
    created_at: '2026-06-05T12:00:00.000Z',
  }],
};

const locationsResponse: LocationReplicaRecordsResponse = {
  success: true,
  locations: [{
    id: '01973e36-4c80-7abc-8a72-111111111111',
    status: 'active',
    displayName: '14 Bell Street',
    placeText: 'Workshop',
    addressText: '14 Bell Street, Testville',
    latitude: 51.5,
    longitude: -0.1,
    providerPlaceId: 'google-place-1',
    contentHash: 'hash-a',
    createdAt: '2026-06-05T12:00:00.000Z',
    updatedAt: '2026-06-05T12:00:00.000Z',
  }],
  aliases: [],
};

const locationsResponseWithLegacyField: LocationReplicaRecordsResponse = {
  success: true,
  locations: [{
    id: '01973e36-4c80-7abc-8a72-111111111111',
    status: 'active',
    displayName: '14 Bell Street',
    placeText: '',
    addressText: '',
    contentHash: 'hash-a',
    // @ts-expect-error localId is not part of Location Replica records.
    local_id: 'location-local-1',
  }],
  aliases: [],
};

void contactsPayload;
void contactsPayloadWithLegacyField;
void locationsPayload;
void locationsPayloadWithLegacyField;
void contactsResponse;
void contactsResponseWithLegacyField;
void locationsResponse;
void locationsResponseWithLegacyField;
