import type { z } from 'zod';
import { entrySyncPayloadSchema } from './entrySync.js';

type EntrySyncPayload = z.infer<typeof entrySyncPayloadSchema>;
type EntrySyncPayloadInput = z.input<typeof entrySyncPayloadSchema>;

const canonicalEntrySyncPayload: EntrySyncPayload = {
  entryData: {
    id: 'entry-local-1',
    captureId: 'capture-local-1',
    transcript: 'Raw words',
    summary: 'Readable Entry text',
    createdAt: '2026-06-05T12:00:00.000Z',
    contextClues: [],
    locations: [],
    contacts: [],
    tags: [],
    attachments: [],
  },
};

canonicalEntrySyncPayload.entryData.createdAt = '2026-06-05T12:01:00.000Z';

// @ts-expect-error Entry sync must not accept the legacy API field name.
canonicalEntrySyncPayload.entryData.created_at = '2026-06-05T12:01:00.000Z';

const payloadWithDefaults: EntrySyncPayloadInput = {
  entryData: {
    summary: 'Readable Entry text',
    createdAt: '2026-06-05T12:00:00.000Z',
  },
};

const payloadWithLegacyCreatedAt: EntrySyncPayloadInput = {
  entryData: {
    summary: 'Readable Entry text',
    // @ts-expect-error createdAt is the canonical field at the API boundary.
    created_at: '2026-06-05T12:00:00.000Z',
  },
};

void canonicalEntrySyncPayload;
void payloadWithDefaults;
void payloadWithLegacyCreatedAt;
