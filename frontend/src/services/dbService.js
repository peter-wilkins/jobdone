import { findReusableLocation } from './locationIdentityService.js';
import { entryMatchesLocation } from './locationPresentationService.js';
import { createUuidV7 } from '../../../shared/contracts/clientId.js';
import {
  normalizeLegacyLocalCaptureRecord,
  parseEntryFromCaptureInput,
  parseLocalCaptureInput,
  parseLocalCaptureRecord,
  parseLocalCaptureUpdate,
} from '../contracts/localCapture.js';

/**
 * IndexedDB service for local entry storage
 * Handles persistence of recordings, transcripts, and metadata
 */

const DB_NAME = 'plumber-job-log';
const DB_VERSION = 16;
const STORE_NAME = 'entries';
const FEEDBACK_STORE = 'feedback';
const QUERIES_STORE = 'queries';
const CAPTURES_STORE = 'captures';
const CONTEXT_CLUES_STORE = 'contextClues';
const LOCATIONS_STORE = 'locations';
const ENTRY_LOCATIONS_STORE = 'entryLocations';
const TAG_CATEGORIES_STORE = 'tagCategories';
const TAGS_STORE = 'tags';
const TAG_VOCABULARY_STORE = 'tagVocabulary';
const ENTRY_TAGS_STORE = 'entryTags';
const CONTACTS_STORE = 'contacts';
const CLIENT_ID_ALIASES_STORE = 'clientIdAliases';
const DEFAULT_TAG_CATEGORY = {
  id: 'tag-category-general',
  name: 'General',
  slug: 'general',
};

function normalizeSearchText(value) {
  return String(value || '')
    .normalize('NFKC')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function normalizeLocationStatus(status) {
  if (status === 'archived') return 'archived';
  return 'active';
}

function isActiveLocationStatus(status) {
  return status === 'active' || status === 'confirmed';
}

function containsExactPhrase(haystack, phrase) {
  const normalizedHaystack = ` ${normalizeSearchText(haystack)} `;
  const normalizedPhrase = normalizeSearchText(phrase);
  if (!normalizedPhrase) return false;
  return normalizedHaystack.includes(` ${normalizedPhrase} `);
}

const RESERVED_CONTEXT_CLUE_PAYLOAD_KEYS = new Set([
  'body',
  'description',
  'transcript',
  'contactDetails',
  'rawPayload',
]);

function compactPayload(payload = {}) {
  return Object.fromEntries(
    Object.entries(payload || {}).filter(([key, value]) =>
      !RESERVED_CONTEXT_CLUE_PAYLOAD_KEYS.has(key) && value !== undefined
    )
  );
}

function compactCalendarPayload(event = {}) {
  return compactPayload({
    title: event.title || '',
    start: event.start || event.start_at || null,
    end: event.end || event.end_at || null,
    locationText: event.locationText || event.location || '',
    attendeeHints: Array.isArray(event.attendeeHints) ? event.attendeeHints : [],
    providerIdHash: event.providerIdHash || event.sourceIdHash || null,
  });
}

function normalizeLocationText(value) {
  return String(value || '')
    .normalize('NFKC')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeLocationKey(value) {
  return normalizeLocationText(value).toLowerCase();
}

function normalizeTagLabel(value) {
  return String(value || '')
    .normalize('NFKC')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeTagKey(value) {
  return normalizeTagLabel(value).toLowerCase();
}

function safeLocalKey(value) {
  return normalizeTagKey(value)
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48) || 'tag';
}

export function validateTagLabel(value) {
  if (/[\p{C}]/u.test(String(value || ''))) {
    return { valid: false, label: String(value || ''), error: 'Tags can use letters, numbers, spaces, hyphens, and underscores' };
  }
  const label = normalizeTagLabel(value);
  if (!label) return { valid: false, label, error: 'Tag is required' };
  if (label.length > 40) return { valid: false, label, error: 'Tags must be 40 characters or fewer' };
  if (!/^[\p{L}\p{N}][\p{L}\p{N} _-]*$/u.test(label)) {
    return { valid: false, label, error: 'Tags can use letters, numbers, spaces, hyphens, and underscores' };
  }
  return { valid: true, label, error: null };
}

export function entryMentionsContact(entry, contact) {
  const displayName = normalizeSearchText(contact?.displayName);
  if (!displayName) return false;

  const searchableText = [
    entry?.summary,
    entry?.transcript,
  ].filter(Boolean).join(' ');

  return containsExactPhrase(searchableText, displayName);
}

export const entryMentionsPerson = entryMentionsContact;

export function mergeEntryUpdates(entry = {}, updates = {}) {
  if (entry.status === 'confirmed') {
    const safeUpdates = normalizeEntryUpdates(updates || {});
    delete safeUpdates.status;
    delete safeUpdates.transcript;
    delete safeUpdates.summary;
    delete safeUpdates.intent;
    delete safeUpdates.audioBlob;
    delete safeUpdates.attachments;
    return {
      ...entry,
      ...safeUpdates,
      status: 'confirmed',
    };
  }

  return {
    ...entry,
    ...normalizeEntryUpdates(updates || {}),
  };
}

function normalizeEntryUpdates(updates = {}) {
  const normalized = { ...(updates || {}) };
  if ('created_at' in normalized && !('createdAt' in normalized)) normalized.createdAt = normalized.created_at;
  if ('capture_id' in normalized && !('captureId' in normalized)) normalized.captureId = normalized.capture_id;
  if ('synced_at' in normalized && !('syncedAt' in normalized)) normalized.syncedAt = normalized.synced_at;
  if ('locationSnapshots' in normalized && !('locations' in normalized)) normalized.locations = normalized.locationSnapshots;
  if ('contactSnapshots' in normalized && !('contacts' in normalized)) normalized.contacts = normalized.contactSnapshots;
  if ('tagSnapshots' in normalized && !('tags' in normalized)) normalized.tags = normalized.tagSnapshots;
  if ('attachmentSnapshots' in normalized && !('attachments' in normalized)) normalized.attachments = normalized.attachmentSnapshots;
  if ('workContextSnapshots' in normalized && !('workContexts' in normalized)) normalized.workContexts = normalized.workContextSnapshots;

  delete normalized.created_at;
  delete normalized.capture_id;
  delete normalized.synced_at;
  delete normalized.locationSnapshots;
  delete normalized.contactSnapshots;
  delete normalized.tagSnapshots;
  delete normalized.attachmentSnapshots;
  delete normalized.workContextSnapshots;
  return normalized;
}

export function normalizeEntryRecord(entry = {}) {
  if (!entry) return entry;
  const normalized = normalizeEntryUpdates(entry);
  return {
    ...normalized,
    captureId: normalized.captureId || null,
    syncedAt: normalized.syncedAt || null,
    locations: Array.isArray(normalized.locations) ? normalized.locations : [],
    contacts: Array.isArray(normalized.contacts) ? normalized.contacts : [],
    tags: Array.isArray(normalized.tags) ? normalized.tags : [],
    attachments: Array.isArray(normalized.attachments) ? normalized.attachments : [],
    workContexts: Array.isArray(normalized.workContexts) ? normalized.workContexts : [],
  };
}

function assertParsedContract(parsed, fallbackMessage) {
  if (parsed.success) return parsed.data;
  throw new Error(parsed.error || fallbackMessage);
}

function normalizeLocalCaptureRecord(capture = {}) {
  return assertParsedContract(
    parseLocalCaptureRecord(normalizeLegacyLocalCaptureRecord(capture)),
    'Invalid local Capture record',
  );
}

export class DBService {
  constructor() {
    this.db = null;
    this.initPromise = null;
  }

  /**
   * Initialize database
   */
  async init() {
    if (this.db) return this.db;
    if (this.initPromise) return this.initPromise;

    const openOnce = () => new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onerror = () => {
        reject(new Error(request.error?.message || 'Failed to open database'));
      };

      request.onblocked = () => {
        reject(new Error('Database upgrade blocked. Close other JobDone tabs and reload.'));
      };

      request.onsuccess = () => {
        this.db = request.result;
        this.db.onversionchange = () => {
          this.db.close();
          this.db = null;
        };
        resolve(this.db);
      };

      request.onupgradeneeded = (event) => {
        const db = event.target.result;

        // v4: rename jobs → entries (drop old store, no prod users)
        if (db.objectStoreNames.contains('jobs')) {
          db.deleteObjectStore('jobs');
        }

        // Entries store
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          const store = db.createObjectStore(STORE_NAME, { keyPath: 'id' });
          store.createIndex('status', 'status', { unique: false });
          store.createIndex('createdAt', 'createdAt', { unique: false });
          store.createIndex('sync_status', 'syncStatus', { unique: false });
          store.createIndex('remoteId', 'remoteId', { unique: false });
          store.createIndex('captureId', 'captureId', { unique: false });
        } else {
          const store = event.target.transaction.objectStore(STORE_NAME);
          if (store.indexNames.contains('created_at')) {
            store.deleteIndex('created_at');
          }
          if (!store.indexNames.contains('createdAt')) {
            store.createIndex('createdAt', 'createdAt', { unique: false });
          }
          if (!store.indexNames.contains('captureId')) {
            store.createIndex('captureId', 'captureId', { unique: false });
          }
          store.openCursor().onsuccess = (cursorEvent) => {
            const cursor = cursorEvent.target.result;
            if (!cursor) return;
            cursor.update(normalizeEntryRecord(cursor.value));
            cursor.continue();
          };
        }

        // v2: feedback store
        if (!db.objectStoreNames.contains(FEEDBACK_STORE)) {
          const feedbackStore = db.createObjectStore(FEEDBACK_STORE, { keyPath: 'id' });
          feedbackStore.createIndex('status', 'status', { unique: false });
          feedbackStore.createIndex('created_at', 'created_at', { unique: false });
        }

        // v5: queries store for QUERY intents
        if (!db.objectStoreNames.contains(QUERIES_STORE)) {
          const queriesStore = db.createObjectStore(QUERIES_STORE, { keyPath: 'id' });
          queriesStore.createIndex('created_at', 'created_at', { unique: false });
          queriesStore.createIndex('syncStatus', 'syncStatus', { unique: false });
        }

        // v6: local-only Capture Inbox for pre-confirmation material
        if (!db.objectStoreNames.contains(CAPTURES_STORE)) {
          const capturesStore = db.createObjectStore(CAPTURES_STORE, { keyPath: 'id' });
          capturesStore.createIndex('status', 'status', { unique: false });
          capturesStore.createIndex('createdAt', 'createdAt', { unique: false });
          capturesStore.createIndex('source', 'source', { unique: false });
          capturesStore.createIndex('kind', 'kind', { unique: false });
        } else {
          const capturesStore = event.target.transaction.objectStore(CAPTURES_STORE);
          if (capturesStore.indexNames.contains('created_at')) {
            capturesStore.deleteIndex('created_at');
          }
          if (!capturesStore.indexNames.contains('createdAt')) {
            capturesStore.createIndex('createdAt', 'createdAt', { unique: false });
          }
          capturesStore.openCursor().onsuccess = (cursorEvent) => {
            const cursor = cursorEvent.target.result;
            if (!cursor) return;
            try {
              cursor.update(normalizeLocalCaptureRecord(cursor.value));
            } catch (error) {
              console.warn('[DB] Invalid local Capture preserved during upgrade:', error.message);
            }
            cursor.continue();
          };
        }

        // v8: local-first Contacts store.
        if (!db.objectStoreNames.contains(CONTACTS_STORE)) {
          const contactStore = db.createObjectStore(CONTACTS_STORE, { keyPath: 'id' });
          contactStore.createIndex('status', 'status', { unique: false });
          contactStore.createIndex('created_at', 'created_at', { unique: false });
          contactStore.createIndex('updated_at', 'updated_at', { unique: false });
          contactStore.createIndex('primaryEmail', 'primaryEmail', { unique: false });
          contactStore.createIndex('primaryPhone', 'primaryPhone', { unique: false });
        }

        // v16: one-way immutable Client ID aliases for Local Replica merge/collapse.
        if (!db.objectStoreNames.contains(CLIENT_ID_ALIASES_STORE)) {
          const aliasStore = db.createObjectStore(CLIENT_ID_ALIASES_STORE, { keyPath: 'fromClientId' });
          aliasStore.createIndex('toClientId', 'toClientId', { unique: false });
          aliasStore.createIndex('collection', 'collection', { unique: false });
          aliasStore.createIndex('created_at', 'created_at', { unique: false });
        }

        // v9: local Context Clue snapshots. Capture-linked clues stay local until Confirmation.
        if (!db.objectStoreNames.contains(CONTEXT_CLUES_STORE)) {
          const contextCluesStore = db.createObjectStore(CONTEXT_CLUES_STORE, { keyPath: 'id' });
          contextCluesStore.createIndex('captureId', 'captureId', { unique: false });
          contextCluesStore.createIndex('entryId', 'entryId', { unique: false });
          contextCluesStore.createIndex('remoteEntryId', 'remoteEntryId', { unique: false });
          contextCluesStore.createIndex('kind', 'kind', { unique: false });
          contextCluesStore.createIndex('created_at', 'created_at', { unique: false });
        }

        // v10: local-first Locations and immutable Entry-Location associations.
        if (!db.objectStoreNames.contains(LOCATIONS_STORE)) {
          const locationsStore = db.createObjectStore(LOCATIONS_STORE, { keyPath: 'id' });
          locationsStore.createIndex('status', 'status', { unique: false });
          locationsStore.createIndex('created_at', 'created_at', { unique: false });
          locationsStore.createIndex('updated_at', 'updated_at', { unique: false });
          locationsStore.createIndex('remoteId', 'remoteId', { unique: false });
          locationsStore.createIndex('normalizedDisplayName', 'normalizedDisplayName', { unique: false });
        }

        if (!db.objectStoreNames.contains(ENTRY_LOCATIONS_STORE)) {
          const entryLocationsStore = db.createObjectStore(ENTRY_LOCATIONS_STORE, { keyPath: 'id' });
          entryLocationsStore.createIndex('entryId', 'entryId', { unique: false });
          entryLocationsStore.createIndex('locationId', 'locationId', { unique: false });
          entryLocationsStore.createIndex('remoteEntryId', 'remoteEntryId', { unique: false });
          entryLocationsStore.createIndex('created_at', 'created_at', { unique: false });
        }

        // v11: local-first Tags, Tag Categories, Vocabulary stats, and immutable Entry-Tag links.
        if (!db.objectStoreNames.contains(TAG_CATEGORIES_STORE)) {
          const categoriesStore = db.createObjectStore(TAG_CATEGORIES_STORE, { keyPath: 'id' });
          categoriesStore.createIndex('slug', 'slug', { unique: false });
          categoriesStore.createIndex('created_at', 'created_at', { unique: false });
        }

        if (!db.objectStoreNames.contains(TAGS_STORE)) {
          const tagsStore = db.createObjectStore(TAGS_STORE, { keyPath: 'id' });
          tagsStore.createIndex('categoryId', 'categoryId', { unique: false });
          tagsStore.createIndex('normalizedLabel', 'normalizedLabel', { unique: false });
          tagsStore.createIndex('status', 'status', { unique: false });
          tagsStore.createIndex('remoteId', 'remoteId', { unique: false });
          tagsStore.createIndex('updated_at', 'updated_at', { unique: false });
        }

        if (!db.objectStoreNames.contains(TAG_VOCABULARY_STORE)) {
          const vocabularyStore = db.createObjectStore(TAG_VOCABULARY_STORE, { keyPath: 'tagId' });
          vocabularyStore.createIndex('last_used_at', 'last_used_at', { unique: false });
          vocabularyStore.createIndex('use_count', 'use_count', { unique: false });
        }

        if (!db.objectStoreNames.contains(ENTRY_TAGS_STORE)) {
          const entryTagsStore = db.createObjectStore(ENTRY_TAGS_STORE, { keyPath: 'id' });
          entryTagsStore.createIndex('entryId', 'entryId', { unique: false });
          entryTagsStore.createIndex('tagId', 'tagId', { unique: false });
          entryTagsStore.createIndex('remoteEntryId', 'remoteEntryId', { unique: false });
          entryTagsStore.createIndex('created_at', 'created_at', { unique: false });
        }
      };
    });

    this.initPromise = (async () => {
      try {
        return await openOnce();
      } catch (error) {
        console.error('[DB] Open failed; preserving local database:', error.message);
        throw error;
      } finally {
        this.initPromise = null;
      }
    })();

    return this.initPromise;
  }

  /**
   * Create a new entry
   * @param {Object} entryData - Entry metadata
   * @param {Blob} audioBlob - Audio recording blob
   * @returns {Promise<string>} Entry ID
   */
  async createEntry(entryData, audioBlob) {
    const db = await this.ensureDb();

    const entry = {
      id: this.generateId(),
      ...entryData,
      audioBlob,
      audioSize: audioBlob.size,
      audioDuration: entryData.duration,
      status: 'recording',
      syncStatus: 'pending',
      remoteId: null,
      createdAt: new Date().toISOString(),
      syncedAt: null,
      captureId: null,
      transcript: null,
      summary: null,
      locations: [],
      contacts: [],
      tags: [],
      attachments: [],
      workContexts: [],
    };

    return new Promise((resolve, reject) => {
      const transaction = db.transaction([STORE_NAME], 'readwrite');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.add(normalizeEntryRecord(entry));

      request.onsuccess = () => {
        resolve(entry.id);
      };

      request.onerror = () => {
        reject(new Error('Failed to create entry'));
      };
    });
  }

  /**
   * Create a text-first entry Capture for review. No audio/transcription required.
   */
  async createTextEntry(entryData = {}) {
    const db = await this.ensureDb();
    const now = new Date().toISOString();
    const text = entryData.text || '';

    const entry = {
      id: this.generateId(),
      ...entryData,
      audioBlob: null,
      audioSize: 0,
      audioDuration: null,
      status: 'ready_for_review',
      syncStatus: 'pending',
      remoteId: null,
      createdAt: now,
      syncedAt: null,
      captureId: null,
      transcript: text,
      summary: text,
      intent: entryData.intent || 'NOTE',
      source: entryData.source || 'text',
      locations: [],
      contacts: [],
      tags: [],
      attachments: [],
      workContexts: [],
    };

    return new Promise((resolve, reject) => {
      const transaction = db.transaction([STORE_NAME], 'readwrite');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.add(normalizeEntryRecord(entry));

      request.onsuccess = () => {
        resolve(entry.id);
      };

      request.onerror = () => {
        reject(new Error('Failed to create text entry'));
      };
    });
  }

  /**
   * Update entry with transcription + summary data
   */
  async updateEntryWithTranscription(entryId, { transcript, summary, intent, transcriptionSource, transcriptionCandidates }) {
    const db = await this.ensureDb();

    return new Promise((resolve, reject) => {
      const transaction = db.transaction([STORE_NAME], 'readwrite');
      const store = transaction.objectStore(STORE_NAME);
      const getRequest = store.get(entryId);

      getRequest.onsuccess = () => {
        const entry = normalizeEntryRecord(getRequest.result);
        if (!entry) {
          reject(new Error('Entry not found'));
          return;
        }

        if (entry.status === 'confirmed') {
          resolve(entry);
          return;
        }

        Object.assign(entry, mergeEntryUpdates(entry, {
          transcript,
          summary,
          intent: intent || entry.intent,
          transcriptionSource: transcriptionSource || entry.transcriptionSource,
          transcriptionCandidates: Array.isArray(transcriptionCandidates) ? transcriptionCandidates : entry.transcriptionCandidates,
          errorMessage: null,
          status: 'ready_for_review',
        }));

        const updateRequest = store.put(normalizeEntryRecord(entry));

        updateRequest.onsuccess = () => {
          this.promoteContextCluesFromCapture(entry.captureId, entry.id)
            .then(() => resolve(entry))
            .catch(reject);
        };

        updateRequest.onerror = () => {
          reject(new Error('Failed to update entry'));
        };
      };

      getRequest.onerror = () => {
        reject(new Error('Failed to fetch entry'));
      };
    });
  }

  /**
   * Update entry with arbitrary fields
   * @param {string} entryId
   * @param {Object} updates - Fields to update
   * @returns {Promise<Object>} Updated entry
   */
  async updateEntry(entryId, updates) {
    const db = await this.ensureDb();

    return new Promise((resolve, reject) => {
      const transaction = db.transaction([STORE_NAME], 'readwrite');
      const store = transaction.objectStore(STORE_NAME);
      const getRequest = store.get(entryId);

      getRequest.onsuccess = () => {
        const entry = normalizeEntryRecord(getRequest.result);
        if (!entry) {
          reject(new Error('Entry not found'));
          return;
        }

        Object.assign(entry, mergeEntryUpdates(entry, updates));

        const updateRequest = store.put(normalizeEntryRecord(entry));

        updateRequest.onsuccess = () => {
          resolve(entry);
        };

        updateRequest.onerror = () => {
          reject(new Error('Failed to update entry'));
        };
      };

      getRequest.onerror = () => {
        reject(new Error('Failed to fetch entry'));
      };
    });
  }

  /**
   * Confirm an entry (delete audio, move to saved)
   */
  async confirmEntry(entryId, { locations = [], contacts = [], tags = [], workContexts = [] } = {}) {
    const db = await this.ensureDb();
    const existingLocations = Array.isArray(locations) && locations.length
      ? await this.getLocations('confirmed')
      : [];

    return new Promise((resolve, reject) => {
      const transaction = db.transaction([
        STORE_NAME,
        LOCATIONS_STORE,
        ENTRY_LOCATIONS_STORE,
        TAG_CATEGORIES_STORE,
        TAGS_STORE,
        TAG_VOCABULARY_STORE,
        ENTRY_TAGS_STORE,
      ], 'readwrite');
      const store = transaction.objectStore(STORE_NAME);
      const locationsStore = transaction.objectStore(LOCATIONS_STORE);
      const entryLocationsStore = transaction.objectStore(ENTRY_LOCATIONS_STORE);
      const tagCategoriesStore = transaction.objectStore(TAG_CATEGORIES_STORE);
      const tagsStore = transaction.objectStore(TAGS_STORE);
      const tagVocabularyStore = transaction.objectStore(TAG_VOCABULARY_STORE);
      const entryTagsStore = transaction.objectStore(ENTRY_TAGS_STORE);
      const getRequest = store.get(entryId);

      getRequest.onsuccess = () => {
        const entry = normalizeEntryRecord(getRequest.result);
        if (!entry) {
          reject(new Error('Entry not found'));
          return;
        }

        // Delete audio blob to save space
        entry.audioBlob = null;
        entry.status = 'confirmed';
        entry.syncStatus = 'pending';
        entry.locationIds = [];
        entry.locations = [];
        entry.contactIds = [];
        entry.contacts = [];
        entry.tagIds = [];
        entry.tags = [];
        entry.workContextIds = [];
        entry.workContexts = [];

        const now = new Date().toISOString();
        const normalizedLocations = locations
          .map(location => this.normalizeLocationDraft(location))
          .filter(Boolean);

        for (const location of normalizedLocations) {
          const reusableLocation = location.id
            ? null
            : findReusableLocation(existingLocations, location);
          const locationId = location.id || reusableLocation?.id || this.generateLocationId();
          const snapshot = {
            id: locationId,
            displayName: reusableLocation?.displayName || location.displayName,
            placeText: reusableLocation?.placeText || location.placeText,
            addressText: reusableLocation?.addressText || location.addressText,
            latitude: reusableLocation?.latitude ?? location.latitude,
            longitude: reusableLocation?.longitude ?? location.longitude,
          };
          const locationRecord = {
            ...(reusableLocation || {}),
            ...snapshot,
            status: 'active',
            normalizedDisplayName: normalizeLocationKey(snapshot.displayName),
            created_at: reusableLocation?.created_at || location.created_at || now,
            updated_at: now,
          };
          locationsStore.put(locationRecord);
          entryLocationsStore.put({
            id: `entry-location-${entryId}-${locationId}`,
            entryId,
            locationId,
            remoteEntryId: entry.remoteId || null,
            created_at: now,
          });
          entry.locationIds.push(locationId);
          entry.locations.push(snapshot);
        }

        const normalizedContacts = contacts
          .map(contact => ({
            id: contact.id || contact.localId || contact.local_id || null,
            displayName: normalizeLocationText(contact.displayName || contact.display_name || contact.label || ''),
            primaryPhone: contact.primaryPhone || contact.primary_phone || null,
            primaryEmail: contact.primaryEmail || contact.primary_email || null,
            phones: contact.phones || [],
            emails: contact.emails || [],
            normalizedPhones: contact.normalizedPhones || contact.normalized_phones || [],
            normalizedEmails: contact.normalizedEmails || contact.normalized_emails || [],
          }))
          .filter(contact => contact.id && contact.displayName);

        for (const contact of normalizedContacts) {
          entry.contactIds.push(contact.id);
          entry.contacts.push(contact);
        }

        const normalizedTags = tags
          .map(tag => this.normalizeTagDraft(tag))
          .filter(Boolean);

        if (normalizedTags.length) {
          tagCategoriesStore.put({
            ...DEFAULT_TAG_CATEGORY,
            created_at: now,
            updated_at: now,
          });
        }

        for (const tag of normalizedTags) {
          const tagId = tag.id || this.generateTagId(tag.label, tag.categoryId);
          const snapshot = {
            id: tagId,
            label: tag.label,
            normalizedLabel: normalizeTagKey(tag.label),
            categoryId: tag.categoryId,
            categoryName: tag.categoryName,
          };
          tagsStore.put({
            ...snapshot,
            status: 'confirmed',
            remoteId: tag.remoteId || null,
            created_at: tag.created_at || now,
            updated_at: now,
          });
          entryTagsStore.put({
            id: `entry-tag-${entryId}-${tagId}`,
            entryId,
            tagId,
            remoteEntryId: entry.remoteId || null,
            created_at: now,
          });
          tagVocabularyStore.put({
            tagId,
            label: tag.label,
            categoryId: tag.categoryId,
            created_at: tag.created_at || now,
            last_used_at: now,
            use_count: (tag.useCount || 0) + 1,
            accepted_count: (tag.acceptedCount || 0) + 1,
            rejected_count: tag.rejectedCount || 0,
          });
          entry.tagIds.push(tagId);
          entry.tags.push(snapshot);
        }

        const normalizedWorkContexts = (workContexts || [])
          .map(context => ({
            id: context.id || null,
            type: context.type || 'backlog_item',
            label: normalizeLocationText(context.label || context.description || ''),
            description: normalizeLocationText(context.description || context.label || ''),
            teamId: context.teamId || context.team_id || context.team?.id || null,
            teamName: context.teamName || context.team_name || context.team?.name || '',
            status: context.status || null,
          }))
          .filter(context => context.id && context.label);

        for (const context of normalizedWorkContexts) {
          entry.workContextIds.push(context.id);
          entry.workContexts.push(context);
        }

        const updateRequest = store.put(normalizeEntryRecord(entry));

        updateRequest.onsuccess = () => {
          resolve(entry);
        };

        updateRequest.onerror = () => {
          reject(new Error('Failed to confirm entry'));
        };
      };

      getRequest.onerror = () => {
        reject(new Error('Failed to fetch entry'));
      };
    });
  }

  /**
   * Create an Entry directly from a Capture (for share-target text/link confirms).
   * Entry is created as 'confirmed' since user already reviewed.
   * @param {object} params
   * @param {string} params.captureId - Source capture ID (for reference)
   * @param {string} params.transcript - Entry transcript
   * @param {string} params.summary - Entry summary
   * @param {string} [params.createdAt] - Optional timestamp (defaults to now)
   * @returns {Promise<string>} New entry ID
   */
  async createEntryFromCapture(input = {}) {
    const {
      captureId,
      transcript,
      summary,
      createdAt,
      locations = [],
      contacts = [],
      tags = [],
      attachments = [],
    } = assertParsedContract(parseEntryFromCaptureInput(input), 'Invalid Entry-from-Capture input');
    const db = await this.ensureDb();
    const now = new Date().toISOString();
    const existingLocations = Array.isArray(locations) && locations.length
      ? await this.getLocations('confirmed')
      : [];
    const locationSnapshots = locations
      .map(location => this.normalizeLocationDraft(location))
      .filter(Boolean)
      .map(location => {
        const reusableLocation = location.id ? null : findReusableLocation(existingLocations, location);
        return {
          id: location.id || reusableLocation?.id || this.generateLocationId(),
          displayName: reusableLocation?.displayName || location.displayName,
          placeText: reusableLocation?.placeText || location.placeText,
          addressText: reusableLocation?.addressText || location.addressText,
          latitude: reusableLocation?.latitude ?? location.latitude,
          longitude: reusableLocation?.longitude ?? location.longitude,
          providerPlaceId: location.providerPlaceId || reusableLocation?.providerPlaceId || null,
          created_at: reusableLocation?.created_at || location.created_at || now,
        };
      });
    const tagSnapshots = tags
      .map(tag => this.normalizeTagDraft(tag))
      .filter(Boolean)
      .map(tag => ({
        id: tag.id || this.generateTagId(tag.label, tag.categoryId),
        label: tag.label,
        normalizedLabel: normalizeTagKey(tag.label),
        categoryId: tag.categoryId,
        categoryName: tag.categoryName,
      }));

    const entry = {
      id: this.generateId(),
      captureId,
      transcript,
      summary,
      audioBlob: null,
      audioSize: 0,
      audioDuration: null,
      status: 'confirmed',
      syncStatus: 'pending',
      remoteId: null,
      createdAt: createdAt || now,
      syncedAt: null,
      intent: 'NOTE',
      locationIds: locationSnapshots.map(location => location.id),
      locations: locationSnapshots,
      contactIds: contacts.map(contact => contact.id || contact.localId || contact.local_id).filter(Boolean),
      contacts,
      tagIds: tagSnapshots.map(tag => tag.id),
      tags: tagSnapshots,
      attachments,
      workContextIds: [],
      workContexts: [],
    };

    return new Promise((resolve, reject) => {
      const transaction = db.transaction([
        STORE_NAME,
        LOCATIONS_STORE,
        ENTRY_LOCATIONS_STORE,
        TAG_CATEGORIES_STORE,
        TAGS_STORE,
        TAG_VOCABULARY_STORE,
        ENTRY_TAGS_STORE,
      ], 'readwrite');
      const store = transaction.objectStore(STORE_NAME);
      const locationsStore = transaction.objectStore(LOCATIONS_STORE);
      const entryLocationsStore = transaction.objectStore(ENTRY_LOCATIONS_STORE);
      const tagCategoriesStore = transaction.objectStore(TAG_CATEGORIES_STORE);
      const tagsStore = transaction.objectStore(TAGS_STORE);
      const tagVocabularyStore = transaction.objectStore(TAG_VOCABULARY_STORE);
      const entryTagsStore = transaction.objectStore(ENTRY_TAGS_STORE);
      const request = store.add(normalizeEntryRecord(entry));

      for (const location of locationSnapshots) {
        locationsStore.put({
          ...location,
          status: 'active',
          normalizedDisplayName: normalizeLocationKey(location.displayName),
          created_at: location.created_at || now,
          updated_at: now,
        });
        entryLocationsStore.put({
          id: `entry-location-${entry.id}-${location.id}`,
          entryId: entry.id,
          locationId: location.id,
          remoteEntryId: null,
          created_at: now,
        });
      }

      if (tagSnapshots.length) {
        tagCategoriesStore.put({
          ...DEFAULT_TAG_CATEGORY,
          created_at: now,
          updated_at: now,
        });
      }

      for (const tag of tagSnapshots) {
        tagsStore.put({
          ...tag,
          status: 'confirmed',
          remoteId: null,
          created_at: now,
          updated_at: now,
        });
        entryTagsStore.put({
          id: `entry-tag-${entry.id}-${tag.id}`,
          entryId: entry.id,
          tagId: tag.id,
          remoteEntryId: null,
          created_at: now,
        });
        tagVocabularyStore.put({
          tagId: tag.id,
          label: tag.label,
          categoryId: tag.categoryId,
          created_at: now,
          last_used_at: now,
          use_count: 1,
          accepted_count: 1,
          rejected_count: 0,
        });
      }

      request.onsuccess = () => {
        this.promoteContextCluesFromCapture(captureId, entry.id)
          .then(() => resolve(entry.id))
          .catch(reject);
      };
      request.onerror = () => reject(new Error('Failed to create entry from capture'));
    });
  }

  /**
   * Reject an entry (delete it)
   */
  async rejectEntry(entryId) {
    const db = await this.ensureDb();

    return new Promise((resolve, reject) => {
      const transaction = db.transaction([STORE_NAME], 'readwrite');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.delete(entryId);

      request.onsuccess = () => {
        resolve();
      };

      request.onerror = () => {
        reject(new Error('Failed to delete entry'));
      };
    });
  }

  /**
   * Get all entries, optionally filtered by status
   */
  async getEntries(status = null) {
    const db = await this.ensureDb();

    return new Promise((resolve, reject) => {
      const transaction = db.transaction([STORE_NAME], 'readonly');
      const store = transaction.objectStore(STORE_NAME);

      let request;
      if (status) {
        const index = store.index('status');
        request = index.getAll(status);
      } else {
        request = store.getAll();
      }

      request.onsuccess = () => {
        // Remove audioBlob from results (not needed in list view)
        const entries = request.result.map(entry => ({
          ...normalizeEntryRecord(entry),
          audioBlob: undefined,
        }));
        entries.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
        resolve(entries);
      };

      request.onerror = () => {
        reject(new Error('Failed to fetch entries'));
      };
    });
  }

  /**
   * Get a single entry by ID (includes audio blob)
   */
  async getEntry(entryId) {
    const db = await this.ensureDb();

    return new Promise((resolve, reject) => {
      const transaction = db.transaction([STORE_NAME], 'readonly');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.get(entryId);

      request.onsuccess = () => {
        resolve(normalizeEntryRecord(request.result));
      };

      request.onerror = () => {
        reject(new Error('Failed to fetch entry'));
      };
    });
  }

  /**
   * Mark an entry as failed (transcription error)
   */
  async markEntryFailed(entryId, errorMessage) {
    const db = await this.ensureDb();

    return new Promise((resolve, reject) => {
      const transaction = db.transaction([STORE_NAME], 'readwrite');
      const store = transaction.objectStore(STORE_NAME);
      const getRequest = store.get(entryId);

      getRequest.onsuccess = () => {
        const entry = normalizeEntryRecord(getRequest.result);
        if (!entry) { reject(new Error('Entry not found')); return; }

        entry.status = 'failed';
        entry.errorMessage = errorMessage || 'Failed to process recording';

        const updateRequest = store.put(normalizeEntryRecord(entry));
        updateRequest.onsuccess = () => resolve(entry);
        updateRequest.onerror = () => reject(new Error('Failed to mark entry failed'));
      };

      getRequest.onerror = () => reject(new Error('Failed to fetch entry'));
    });
  }

  /**
   * Reset a failed entry back to recording status (for retry)
   */
  async resetEntryForRetry(entryId) {
    const db = await this.ensureDb();

    return new Promise((resolve, reject) => {
      const transaction = db.transaction([STORE_NAME], 'readwrite');
      const store = transaction.objectStore(STORE_NAME);
      const getRequest = store.get(entryId);

      getRequest.onsuccess = () => {
        const entry = normalizeEntryRecord(getRequest.result);
        if (!entry) { reject(new Error('Entry not found')); return; }

        entry.status = 'recording';
        entry.errorMessage = null;

        const updateRequest = store.put(normalizeEntryRecord(entry));
        updateRequest.onsuccess = () => resolve(entry);
        updateRequest.onerror = () => reject(new Error('Failed to reset entry'));
      };

      getRequest.onerror = () => reject(new Error('Failed to fetch entry'));
    });
  }

  /**
   * Mark an entry as successfully synced to cloud
   * @param {string} entryId - local entry id
   * @param {string|null} remoteId - Supabase UUID returned from the server
   */
  async markEntrySynced(entryId, remoteId = null) {
    const db = await this.ensureDb();

    return new Promise((resolve, reject) => {
      const transaction = db.transaction([STORE_NAME], 'readwrite');
      const store = transaction.objectStore(STORE_NAME);
      const getRequest = store.get(entryId);

      getRequest.onsuccess = () => {
        const entry = normalizeEntryRecord(getRequest.result);
        if (!entry) { reject(new Error('Entry not found')); return; }

        entry.syncStatus = 'synced';
        entry.syncedAt = new Date().toISOString();
        entry.remoteId = remoteId;

        const updateRequest = store.put(normalizeEntryRecord(entry));
        updateRequest.onsuccess = () => resolve(entry);
        updateRequest.onerror = () => reject(new Error('Failed to mark entry synced'));
      };

      getRequest.onerror = () => reject(new Error('Failed to fetch entry'));
    });
  }

  /** Get confirmed entries that haven't been synced to cloud yet */
  async getConfirmedEntriesUnsynced() {
    const confirmed = await this.getEntries('confirmed');
    return confirmed.filter(e => !e.remoteId);
  }

  /** Find a local entry by its Supabase remote ID */
  async getEntryByRemoteId(remoteId) {
    const db = await this.ensureDb();
    return new Promise((resolve, reject) => {
      const store = db.transaction([STORE_NAME], 'readonly').objectStore(STORE_NAME);
      const req = store.index('remoteId').get(remoteId);
      req.onsuccess = () => resolve(req.result ? normalizeEntryRecord(req.result) : null);
      req.onerror = () => reject(new Error('Failed to query entry by remoteId'));
    });
  }

  /** Find a local entry by its original creation timestamp */
  async getEntryByCreatedAt(createdAt) {
    const db = await this.ensureDb();
    return new Promise((resolve, reject) => {
      const store = db.transaction([STORE_NAME], 'readonly').objectStore(STORE_NAME);
      const req = store.index('createdAt').get(createdAt);
      req.onsuccess = () => resolve(req.result ? normalizeEntryRecord(req.result) : null);
      req.onerror = () => reject(new Error('Failed to query entry by createdAt'));
    });
  }

  /** Find a local entry by its originating Capture ID */
  async getEntryByCaptureId(captureId) {
    const db = await this.ensureDb();
    return new Promise((resolve, reject) => {
      const store = db.transaction([STORE_NAME], 'readonly').objectStore(STORE_NAME);
      const req = store.index('captureId').get(captureId);
      req.onsuccess = () => resolve(req.result ? normalizeEntryRecord(req.result) : null);
      req.onerror = () => reject(new Error('Failed to query entry by captureId'));
    });
  }

  /** Add an entry fetched from the cloud into local IndexedDB as confirmed */
  async addCloudEntry(cloudJob) {
    const db = await this.ensureDb();
    const cloudLocations = Array.isArray(cloudJob.locations) ? cloudJob.locations : [];
    const cloudContacts = Array.isArray(cloudJob.contacts) ? cloudJob.contacts : [];
    const cloudTags = Array.isArray(cloudJob.tags) ? cloudJob.tags : [];
    const cloudAttachments = Array.isArray(cloudJob.attachments) ? cloudJob.attachments : [];
    const cloudContextClues = Array.isArray(cloudJob.contextClues)
      ? cloudJob.contextClues
      : (Array.isArray(cloudJob.context_clues) ? cloudJob.context_clues : []);
    const entry = {
      id: `entry-cloud-${cloudJob.id}`,
      remoteId: cloudJob.id,
      audioBlob: null,
      audioSize: 0,
      audioDuration: null,
      status: 'confirmed',
      syncStatus: 'synced',
      errorMessage: null,
      transcript: cloudJob.transcript,
      summary: cloudJob.summary,
      createdAt: cloudJob.createdAt || cloudJob.created_at,
      syncedAt: cloudJob.syncedAt || cloudJob.synced_at || new Date().toISOString(),
      captureId: cloudJob.captureId || cloudJob.capture_id || null,
      locationIds: cloudLocations.map(location =>
        location.id
      ).filter(Boolean),
      locations: cloudLocations.map(location => ({
        id: location.id,
        displayName: location.displayName || location.display_name || '',
        placeText: location.placeText || location.place_text || location.displayName || location.display_name || '',
        addressText: location.addressText || location.address_text || '',
        latitude: location.latitude ?? null,
        longitude: location.longitude ?? null,
      })),
      tagIds: cloudTags.map(tag =>
        tag.local_id || tag.localId || tag.id
      ).filter(Boolean),
      contactIds: cloudContacts.map(contact =>
        contact.local_id || contact.localId || contact.id
      ).filter(Boolean),
      contacts: cloudContacts.map(contact => ({
        id: contact.local_id || contact.localId || contact.id,
        displayName: contact.display_name || contact.displayName || '',
        primaryPhone: contact.primary_phone || contact.primaryPhone || null,
        primaryEmail: contact.primary_email || contact.primaryEmail || null,
      })),
      tags: cloudTags.map(tag => ({
        id: tag.local_id || tag.localId || tag.id,
        label: tag.label || '',
        normalizedLabel: tag.normalized_label || tag.normalizedLabel || normalizeTagKey(tag.label || ''),
        categoryId: tag.category_id || tag.categoryId || DEFAULT_TAG_CATEGORY.id,
        categoryName: tag.category_name || tag.categoryName || tag.tag_categories?.name || DEFAULT_TAG_CATEGORY.name,
      })),
      attachments: cloudAttachments,
      workContextIds: (cloudJob.workContexts || []).map(context => context.id).filter(Boolean),
      workContexts: cloudJob.workContexts || [],
    };
    return new Promise((resolve, reject) => {
      const tx = db.transaction([STORE_NAME, LOCATIONS_STORE, ENTRY_LOCATIONS_STORE], 'readwrite');
      const req = tx.objectStore(STORE_NAME).add(normalizeEntryRecord(entry));
      req.onsuccess = () => {
        Promise.all([
          this.upsertCloudContextClues(entry.id, cloudJob.id, cloudContextClues),
          this.upsertCloudEntryLocations(entry.id, cloudJob.id, cloudLocations),
          this.upsertCloudEntryTags(entry.id, cloudJob.id, cloudTags),
        ])
          .then(() => resolve(entry))
          .catch(reject);
      };
      req.onerror = () => reject(new Error('Failed to add cloud entry'));
    });
  }

  async upsertCloudEntryLocations(entryId, remoteEntryId, locations = []) {
    const db = await this.ensureDb();
    if (!Array.isArray(locations) || locations.length === 0) return [];
    return new Promise((resolve, reject) => {
      const tx = db.transaction([LOCATIONS_STORE, ENTRY_LOCATIONS_STORE], 'readwrite');
      const locationStore = tx.objectStore(LOCATIONS_STORE);
      const linkStore = tx.objectStore(ENTRY_LOCATIONS_STORE);
      const saved = [];

      tx.oncomplete = () => resolve(saved);
      tx.onerror = () => reject(new Error('Failed to save cloud entry locations'));

      for (const cloudLocation of locations) {
        const localId = cloudLocation.id;
        if (!localId) continue;
        const row = {
          id: localId,
          displayName: cloudLocation.displayName || cloudLocation.display_name || '',
          placeText: cloudLocation.placeText || cloudLocation.place_text || cloudLocation.displayName || cloudLocation.display_name || '',
          addressText: cloudLocation.addressText || cloudLocation.address_text || '',
          latitude: cloudLocation.latitude ?? null,
          longitude: cloudLocation.longitude ?? null,
          status: normalizeLocationStatus(cloudLocation.status),
          normalizedDisplayName: normalizeLocationKey(cloudLocation.displayName || cloudLocation.display_name || ''),
          providerPlaceId: cloudLocation.providerPlaceId || cloudLocation.provider_place_id || null,
          created_at: cloudLocation.createdAt || cloudLocation.created_at || new Date().toISOString(),
          updated_at: cloudLocation.updatedAt || cloudLocation.updated_at || cloudLocation.createdAt || cloudLocation.created_at || new Date().toISOString(),
        };
        locationStore.put(row);
        linkStore.put({
          id: `entry-location-${entryId}-${localId}`,
          entryId,
          locationId: localId,
          remoteEntryId,
          created_at: cloudLocation.link_created_at || new Date().toISOString(),
        });
        saved.push(row);
      }
    });
  }

  async upsertCloudEntryTags(entryId, remoteEntryId, tags = []) {
    const db = await this.ensureDb();
    if (!Array.isArray(tags) || tags.length === 0) return [];
    return new Promise((resolve, reject) => {
      const tx = db.transaction([TAG_CATEGORIES_STORE, TAGS_STORE, TAG_VOCABULARY_STORE, ENTRY_TAGS_STORE], 'readwrite');
      const categoryStore = tx.objectStore(TAG_CATEGORIES_STORE);
      const tagStore = tx.objectStore(TAGS_STORE);
      const vocabularyStore = tx.objectStore(TAG_VOCABULARY_STORE);
      const linkStore = tx.objectStore(ENTRY_TAGS_STORE);
      const saved = [];
      const now = new Date().toISOString();

      tx.oncomplete = () => resolve(saved);
      tx.onerror = () => reject(new Error('Failed to save cloud entry tags'));

      categoryStore.put({
        ...DEFAULT_TAG_CATEGORY,
        created_at: now,
        updated_at: now,
      });

      for (const cloudTag of tags) {
        const categoryId = cloudTag.category_id || cloudTag.categoryId || DEFAULT_TAG_CATEGORY.id;
        const categoryName = cloudTag.category_name || cloudTag.categoryName || cloudTag.tag_categories?.name || DEFAULT_TAG_CATEGORY.name;
        const label = normalizeTagLabel(cloudTag.label || '');
        if (!label) continue;
        const localId = cloudTag.local_id || cloudTag.localId || `tag-cloud-${cloudTag.id}`;
        const row = {
          id: localId,
          label,
          normalizedLabel: cloudTag.normalized_label || cloudTag.normalizedLabel || normalizeTagKey(label),
          categoryId,
          categoryName,
          status: cloudTag.status || 'confirmed',
          remoteId: cloudTag.id || cloudTag.tag_id || null,
          created_at: cloudTag.created_at || now,
          updated_at: cloudTag.updated_at || cloudTag.created_at || now,
        };
        categoryStore.put({
          id: categoryId,
          name: categoryName,
          slug: safeLocalKey(categoryName),
          created_at: row.created_at,
          updated_at: row.updated_at,
        });
        tagStore.put(row);
        linkStore.put({
          id: `entry-tag-${entryId}-${localId}`,
          entryId,
          tagId: localId,
          remoteEntryId,
          created_at: cloudTag.link_created_at || now,
        });
        vocabularyStore.put({
          tagId: localId,
          label,
          categoryId,
          created_at: row.created_at,
          last_used_at: row.updated_at,
          use_count: cloudTag.use_count || 1,
          accepted_count: cloudTag.accepted_count || 1,
          rejected_count: cloudTag.rejected_count || 0,
        });
        saved.push(row);
      }
    });
  }

  /**
   * Get entries pending sync
   */
  async getPendingSyncEntries() {
    const db = await this.ensureDb();

    return new Promise((resolve, reject) => {
      const transaction = db.transaction([STORE_NAME], 'readonly');
      const store = transaction.objectStore(STORE_NAME);
      const index = store.index('sync_status');
      const request = index.getAll('pending');

      request.onsuccess = () => {
        resolve(request.result);
      };

      request.onerror = () => {
        reject(new Error('Failed to fetch pending entries'));
      };
    });
  }

  /**
   * Ensure database is initialized
   */
  async ensureDb() {
    if (this.db) return this.db;
    return this.init();
  }

  /**
   * Generate unique ID
   */
  generateId() {
    return `entry-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  generateCaptureId() {
    return `capture-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  generateContactId() {
    return `contact-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  generateLocationId() {
    return createUuidV7();
  }

  generateTagId(label, categoryId = DEFAULT_TAG_CATEGORY.id) {
    return `tag-${safeLocalKey(categoryId)}-${safeLocalKey(label)}`;
  }

  generateContextClueId() {
    return `context-clue-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  generatePersonId() {
    return this.generateContactId();
  }

  // ─── Captures ────────────────────────────────────────────────────────────

  /**
   * Create a local-only Capture. Captures never sync before Confirmation.
   *
   * @param {object} captureData
   * @param {string} captureData.source - e.g. voice, share_target, manual
   * @param {Array<object>} captureData.payloads - raw reviewable payload metadata
   * @param {string} [captureData.status] - lifecycle status, defaults ready_for_review
   */
  async createCapture(captureData = {}) {
    const {
      source = 'manual',
      payloads = [],
      status = 'ready_for_review',
      kind = 'entry',
      errorMessage = null,
      devSignal,
    } = assertParsedContract(parseLocalCaptureInput(captureData), 'Invalid local Capture input');
    const db = await this.ensureDb();
    const now = new Date().toISOString();
    const capture = assertParsedContract(parseLocalCaptureRecord({
      id: this.generateCaptureId(),
      source,
      kind,
      payloads,
      status,
      errorMessage,
      ...(devSignal ? { devSignal } : {}),
      createdAt: now,
      updatedAt: now,
    }), 'Invalid local Capture record');

    return new Promise((resolve, reject) => {
      const request = db
        .transaction([CAPTURES_STORE], 'readwrite')
        .objectStore(CAPTURES_STORE)
        .add(capture);

      request.onsuccess = () => resolve(capture.id);
      request.onerror = () => reject(new Error('Failed to create capture'));
    });
  }

  async getCapture(captureId) {
    const db = await this.ensureDb();

    return new Promise((resolve, reject) => {
      const request = db
        .transaction([CAPTURES_STORE], 'readonly')
        .objectStore(CAPTURES_STORE)
        .get(captureId);

      request.onsuccess = () => {
        if (!request.result) {
          resolve(null);
          return;
        }
        try {
          resolve(normalizeLocalCaptureRecord(request.result));
        } catch (error) {
          reject(new Error(error.message || 'Invalid local Capture record'));
        }
      };
      request.onerror = () => reject(new Error('Failed to fetch capture'));
    });
  }

  async getCaptures(status = null) {
    const db = await this.ensureDb();

    return new Promise((resolve, reject) => {
      const store = db.transaction([CAPTURES_STORE], 'readonly').objectStore(CAPTURES_STORE);
      const request = status ? store.index('status').getAll(status) : store.getAll();

      request.onsuccess = () => {
        let captures;
        try {
          captures = request.result
            .map(capture => normalizeLocalCaptureRecord(capture))
            .filter(capture => capture.status !== 'confirmed' && capture.status !== 'rejected')
            .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
        } catch (error) {
          reject(new Error(error.message || 'Invalid local Capture record'));
          return;
        }
        resolve(captures);
      };
      request.onerror = () => reject(new Error('Failed to fetch captures'));
    });
  }

  async updateCapture(captureId, updates) {
    const db = await this.ensureDb();
    const parsedUpdates = assertParsedContract(parseLocalCaptureUpdate(updates), 'Invalid local Capture update');

    return new Promise((resolve, reject) => {
      const store = db.transaction([CAPTURES_STORE], 'readwrite').objectStore(CAPTURES_STORE);
      const getRequest = store.get(captureId);

      getRequest.onsuccess = () => {
        if (!getRequest.result) { reject(new Error('Capture not found')); return; }
        const capture = normalizeLocalCaptureRecord(getRequest.result);

        const nextCapture = assertParsedContract(parseLocalCaptureRecord({
          ...capture,
          ...parsedUpdates,
          updatedAt: new Date().toISOString(),
        }), 'Invalid local Capture record');
        const putRequest = store.put(nextCapture);
        putRequest.onsuccess = () => resolve(nextCapture);
        putRequest.onerror = () => reject(new Error('Failed to update capture'));
      };
      getRequest.onerror = () => reject(new Error('Failed to fetch capture'));
    });
  }

  async rejectCapture(captureId) {
    const db = await this.ensureDb();

    return new Promise((resolve, reject) => {
      const request = db
        .transaction([CAPTURES_STORE], 'readwrite')
        .objectStore(CAPTURES_STORE)
        .delete(captureId);

      request.onsuccess = () => resolve();
      request.onerror = () => reject(new Error('Failed to reject capture'));
    });
  }

  // ─── Context Clues ─────────────────────────────────────────────────────

  async createContextClue({
    captureId = null,
    entryId = null,
    remoteEntryId = null,
    kind,
    source,
    summary = '',
    payload = {},
    confidence = null,
    metadata = {},
    created_at = null,
  }) {
    if (!kind || !source) {
      throw new Error('Context clue kind and source are required');
    }
    if (!captureId && !entryId && !remoteEntryId) {
      throw new Error('Context clue must be linked to a Capture or Entry');
    }

    const db = await this.ensureDb();
    const now = new Date().toISOString();
    const clue = {
      id: this.generateContextClueId(),
      captureId,
      entryId,
      remoteEntryId,
      kind,
      source,
      summary,
      payload: compactPayload(payload),
      confidence,
      metadata: compactPayload(metadata),
      created_at: created_at || now,
      updated_at: now,
    };

    return new Promise((resolve, reject) => {
      const request = db
        .transaction([CONTEXT_CLUES_STORE], 'readwrite')
        .objectStore(CONTEXT_CLUES_STORE)
        .add(clue);

      request.onsuccess = () => resolve(clue);
      request.onerror = () => reject(new Error('Failed to create context clue'));
    });
  }

  async createCalendarEventContextClue({ captureId = null, entryId = null, event, confidence = null, metadata = {} }) {
    const payload = compactCalendarPayload(event);
    return this.createContextClue({
      captureId,
      entryId,
      kind: 'calendar_event',
      source: 'calendar',
      summary: payload.title ? `Calendar event: ${payload.title}` : 'Calendar event',
      payload,
      confidence,
      metadata,
    });
  }

  async createDeviceLocationContextClue({ captureId = null, entryId = null, clue }) {
    return this.createContextClue({
      captureId,
      entryId,
      kind: 'device_location',
      source: 'device_location',
      summary: clue.summary || 'Current location at capture time',
      payload: clue.payload || {},
      confidence: clue.confidence ?? 0.55,
      metadata: clue.metadata || {},
      created_at: clue.created_at || null,
    });
  }

  async getContextCluesForCapture(captureId) {
    return this.getContextCluesByIndex('captureId', captureId);
  }

  async getContextCluesForEntry(entryId) {
    return this.getContextCluesByIndex('entryId', entryId);
  }

  async getContextCluesByIndex(indexName, value) {
    if (!value) return [];
    const db = await this.ensureDb();
    return new Promise((resolve, reject) => {
      const store = db.transaction([CONTEXT_CLUES_STORE], 'readonly').objectStore(CONTEXT_CLUES_STORE);
      const request = store.index(indexName).getAll(value);
      request.onsuccess = () => {
        const clues = (request.result || []).sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
        resolve(clues);
      };
      request.onerror = () => reject(new Error('Failed to fetch context clues'));
    });
  }

  async promoteContextCluesFromCapture(captureId, entryId) {
    if (!captureId || !entryId) return [];
    const db = await this.ensureDb();
    const clues = await this.getContextCluesForCapture(captureId);
    if (!clues.length) return [];

    return new Promise((resolve, reject) => {
      const tx = db.transaction([CONTEXT_CLUES_STORE], 'readwrite');
      const store = tx.objectStore(CONTEXT_CLUES_STORE);
      for (const clue of clues) {
        store.put({
          ...clue,
          entryId,
          updated_at: new Date().toISOString(),
        });
      }
      tx.oncomplete = () => resolve(clues.map(clue => ({ ...clue, entryId })));
      tx.onerror = () => reject(new Error('Failed to promote context clues'));
    });
  }

  async upsertCloudContextClues(entryId, remoteEntryId, cloudClues = []) {
    if (!entryId || !Array.isArray(cloudClues) || cloudClues.length === 0) return [];
    const db = await this.ensureDb();
    const now = new Date().toISOString();
    const clues = cloudClues.map(clue => ({
      id: clue.local_id || clue.id || this.generateContextClueId(),
      remoteId: clue.id || null,
      entryId,
      captureId: null,
      remoteEntryId,
      kind: clue.kind,
      source: clue.source,
      summary: clue.summary || '',
      payload: compactPayload(clue.payload || {}),
      confidence: clue.confidence ?? null,
      metadata: compactPayload(clue.metadata || {}),
      created_at: clue.created_at || now,
      updated_at: now,
    }));

    return new Promise((resolve, reject) => {
      const tx = db.transaction([CONTEXT_CLUES_STORE], 'readwrite');
      const store = tx.objectStore(CONTEXT_CLUES_STORE);
      for (const clue of clues) store.put(clue);
      tx.oncomplete = () => resolve(clues);
      tx.onerror = () => reject(new Error('Failed to save cloud context clues'));
    });
  }

  // ─── Contacts ───────────────────────────────────────────────────────────

  async createContact(contactData) {
    const db = await this.ensureDb();
    const now = new Date().toISOString();
    const contact = {
      id: this.generateContactId(),
      status: 'confirmed',
      displayName: '',
      givenName: '',
      familyName: '',
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
      remoteId: null,
      syncStatus: 'pending',
      synced_at: null,
      created_at: now,
      updated_at: now,
      ...contactData,
    };

    const tx = db.transaction([CONTACTS_STORE], 'readwrite');
    const request = tx.objectStore(CONTACTS_STORE).add(contact);

    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(contact);
      request.onerror = () => reject(new Error('Failed to create contact'));
    });
  }

  async createPerson(personData) {
    return this.createContact(personData);
  }

  async getContact(contactId) {
    const db = await this.ensureDb();
    return new Promise((resolve, reject) => {
      const request = db.transaction([CONTACTS_STORE], 'readonly').objectStore(CONTACTS_STORE).get(contactId);
      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => reject(new Error('Failed to fetch contact'));
    });
  }

  async getPerson(personId) {
    return this.getContact(personId);
  }

  async deleteContact(contactId) {
    const linkedEntries = await this.getEntriesForContact(contactId);
    if (linkedEntries.length > 0) {
      throw new Error('Cannot delete a contact linked to entries');
    }

    const db = await this.ensureDb();
    return new Promise((resolve, reject) => {
      const request = db.transaction([CONTACTS_STORE], 'readwrite').objectStore(CONTACTS_STORE).delete(contactId);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(new Error('Failed to delete contact'));
    });
  }

  async deletePerson(personId) {
    return this.deleteContact(personId);
  }

  async getContacts(status = 'confirmed') {
    const db = await this.ensureDb();
    const aliases = await this.getContactAliases();
    return new Promise((resolve, reject) => {
      const store = db.transaction([CONTACTS_STORE], 'readonly').objectStore(CONTACTS_STORE);
      const request = status ? store.index('status').getAll(status) : store.getAll();
      request.onsuccess = () => {
        const aliasMap = new Map(aliases.map(alias => [alias.fromClientId, alias.toClientId]));
        const byId = new Map((request.result || []).map(contact => [contact.id, contact]));
        const contacts = (request.result || [])
          .filter(contact => !(aliasMap.has(contact.id) && byId.has(aliasMap.get(contact.id))))
          .sort((a, b) => new Date(b.updated_at || b.created_at) - new Date(a.updated_at || a.created_at));
        resolve(contacts);
      };
      request.onerror = () => reject(new Error('Failed to fetch contacts'));
    });
  }

  async getContactsForReplica() {
    const db = await this.ensureDb();
    return new Promise((resolve, reject) => {
      const store = db.transaction([CONTACTS_STORE], 'readonly').objectStore(CONTACTS_STORE);
      const request = store.index('status').getAll('confirmed');
      request.onsuccess = () => resolve((request.result || []));
      request.onerror = () => reject(new Error('Failed to fetch contacts for replica'));
    });
  }

  async getContactAliases() {
    const aliases = await this.getClientIdAliases('contacts');
    return aliases;
  }

  async getLocationAliases() {
    return this.getClientIdAliases('locations');
  }

  async getClientIdAliases(collection = null) {
    const db = await this.ensureDb();
    return new Promise((resolve, reject) => {
      if (!db.objectStoreNames.contains(CLIENT_ID_ALIASES_STORE)) {
        resolve([]);
        return;
      }
      const request = db.transaction([CLIENT_ID_ALIASES_STORE], 'readonly').objectStore(CLIENT_ID_ALIASES_STORE).getAll();
      request.onsuccess = () => {
        const aliases = request.result || [];
        resolve(collection ? aliases.filter(alias => alias.collection === collection) : aliases);
      };
      request.onerror = () => reject(new Error('Failed to fetch Client ID aliases'));
    });
  }

  async saveContactAlias(alias = {}) {
    return this.saveClientIdAlias({ collection: 'contacts', ...alias });
  }

  async saveLocationAlias(alias = {}) {
    return this.saveClientIdAlias({ collection: 'locations', ...alias });
  }

  async saveClientIdAlias(alias = {}) {
    if (!alias.fromClientId || !alias.toClientId || alias.fromClientId === alias.toClientId) return null;
    const db = await this.ensureDb();
    const row = {
      collection: alias.collection || 'unknown',
      reason: 'unknown',
      created_at: new Date().toISOString(),
      ...alias,
    };
    return new Promise((resolve, reject) => {
      const store = db.transaction([CLIENT_ID_ALIASES_STORE], 'readwrite').objectStore(CLIENT_ID_ALIASES_STORE);
      const getRequest = store.get(row.fromClientId);
      getRequest.onsuccess = () => {
        const existing = getRequest.result;
        if (existing) {
          resolve(existing);
          return;
        }
        const putRequest = store.put(row);
        putRequest.onsuccess = () => resolve(row);
        putRequest.onerror = () => reject(new Error('Failed to save Client ID alias'));
      };
      getRequest.onerror = () => reject(new Error('Failed to read Client ID alias'));
    });
  }

  async searchContacts(query) {
    const contacts = await this.getContacts('confirmed');
    const needle = String(query || '').trim().toLowerCase();
    if (!needle) return contacts;

    return contacts.filter(contact => {
      const haystack = [
        contact.displayName,
        contact.givenName,
        contact.familyName,
        contact.organization,
        contact.title,
        ...(contact.emails || []).map(email => email.value),
        ...(contact.phones || []).map(phone => phone.value),
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return haystack.includes(needle);
    });
  }

  async getEntriesForContact(contactId) {
    const contact = await this.getContact(contactId);
    if (!contact) return [];

    const sourceCaptureIds = new Set((contact.sourceCaptureIds || []).filter(Boolean));
    const entries = await this.getEntries('confirmed');
    return entries.filter(entry =>
      (entry.captureId && sourceCaptureIds.has(entry.captureId)) ||
      (Array.isArray(entry.contactIds) && entry.contactIds.includes(contactId)) ||
      entryMentionsContact(entry, contact)
    );
  }

  async findContactsByContactKeys({ normalizedEmails = [], normalizedPhones = [] } = {}) {
    const contacts = await this.getContacts('confirmed');
    const emailSet = new Set((normalizedEmails || []).filter(Boolean));
    const phoneSet = new Set((normalizedPhones || []).filter(Boolean));

    return contacts.filter(contact =>
      (contact.normalizedEmails || []).some(email => emailSet.has(email)) ||
      (contact.normalizedPhones || []).some(phone => phoneSet.has(phone))
    );
  }

  async upsertContact(contactData) {
    const db = await this.ensureDb();
    const now = new Date().toISOString();
    const normalizedEmails = Array.from(new Set((contactData.normalizedEmails || []).filter(Boolean)));
    const normalizedPhones = Array.from(new Set((contactData.normalizedPhones || []).filter(Boolean)));
    const matches = await this.findContactsByContactKeys({ normalizedEmails, normalizedPhones });
    const existing = matches[0] || null;
    const primaryEmail = normalizedEmails[0] || null;
    const primaryPhone = normalizedPhones[0] || null;

    if (!existing) {
      return this.createContact({
        ...contactData,
        normalizedEmails,
        normalizedPhones,
        primaryEmail,
        primaryPhone,
      });
    }

    const merged = {
      ...existing,
      displayName: contactData.displayName || existing.displayName,
      givenName: contactData.givenName || existing.givenName,
      familyName: contactData.familyName || existing.familyName,
      organization: contactData.organization || existing.organization,
      title: contactData.title || existing.title,
      note: contactData.note || existing.note,
      phones: this.mergeContactValues(existing.phones, contactData.phones),
      emails: this.mergeContactValues(existing.emails, contactData.emails),
      normalizedPhones: Array.from(new Set([...(existing.normalizedPhones || []), ...normalizedPhones])),
      normalizedEmails: Array.from(new Set([...(existing.normalizedEmails || []), ...normalizedEmails])),
      primaryPhone: existing.primaryPhone || primaryPhone,
      primaryEmail: existing.primaryEmail || primaryEmail,
      sourceCaptureIds: Array.from(new Set([...(existing.sourceCaptureIds || []), ...(contactData.sourceCaptureIds || [])])),
      syncStatus: 'pending',
      updated_at: now,
    };

    return new Promise((resolve, reject) => {
      const tx = db.transaction([CONTACTS_STORE], 'readwrite');
      const store = tx.objectStore(CONTACTS_STORE);
      const req = store.put(merged);
      req.onsuccess = () => resolve(merged);
      req.onerror = () => reject(new Error('Failed to update contact'));
    });
  }

  mergeContactValues(existingValues = [], incomingValues = []) {
    const merged = [...existingValues];
    for (const value of incomingValues || []) {
      const key = value?.normalized || value?.value;
      if (!key) continue;
      if (!merged.some(item => (item?.normalized || item?.value) === key)) {
        merged.push(value);
      }
    }
    return merged;
  }

  async getContactsUnsynced() {
    const contacts = await this.getContacts('confirmed');
    return contacts.filter(contact => contact.syncStatus !== 'synced' || !contact.remoteId);
  }

  async markContactSynced(contactId, remoteId = null) {
    const db = await this.ensureDb();
    return new Promise((resolve, reject) => {
      const store = db.transaction([CONTACTS_STORE], 'readwrite').objectStore(CONTACTS_STORE);
      const request = store.get(contactId);

      request.onsuccess = () => {
        const contact = request.result;
        if (!contact) { reject(new Error('Contact not found')); return; }

        const synced = {
          ...contact,
          remoteId: remoteId || contact.remoteId,
          syncStatus: 'synced',
          synced_at: new Date().toISOString(),
        };
        const updateRequest = store.put(synced);
        updateRequest.onsuccess = () => resolve(synced);
        updateRequest.onerror = () => reject(new Error('Failed to mark contact synced'));
      };

      request.onerror = () => reject(new Error('Failed to fetch contact'));
    });
  }

  async markPersonSynced(personId, remoteId = null) {
    return this.markContactSynced(personId, remoteId);
  }

  async upsertCloudContact(cloudContact) {
    const normalizedEmails = Array.from(new Set((cloudContact.normalizedEmails || cloudContact.normalized_emails || []).filter(Boolean)));
    const normalizedPhones = Array.from(new Set((cloudContact.normalizedPhones || cloudContact.normalized_phones || []).filter(Boolean)));
    const localId = cloudContact.clientId || cloudContact.local_id || cloudContact.localId || null;
    const existingByLocalId = localId ? await this.getContact(localId) : null;
    const matches = await this.findContactsByContactKeys({ normalizedEmails, normalizedPhones });
    const serverId = cloudContact.serverId || cloudContact.id || null;
    const existing = existingByLocalId || matches.find(contact => contact.remoteId === serverId) || matches[0] || null;
    const contactData = {
      displayName: cloudContact.displayName || cloudContact.display_name || '',
      givenName: cloudContact.givenName || cloudContact.given_name || '',
      familyName: cloudContact.familyName || cloudContact.family_name || '',
      organization: cloudContact.organization || '',
      title: cloudContact.title || '',
      note: cloudContact.note || '',
      phones: cloudContact.phones || [],
      emails: cloudContact.emails || [],
      normalizedPhones,
      normalizedEmails,
      primaryPhone: cloudContact.primaryPhone || cloudContact.primary_phone || normalizedPhones[0] || null,
      primaryEmail: cloudContact.primaryEmail || cloudContact.primary_email || normalizedEmails[0] || null,
      sourceCaptureIds: cloudContact.sourceCaptureIds || cloudContact.source_capture_ids || [],
      remoteId: serverId,
      syncStatus: 'synced',
      synced_at: new Date().toISOString(),
    };

    if (!existing) {
      return this.createContact({
        ...contactData,
        id: localId || this.generateContactId(),
        created_at: cloudContact.createdAt || cloudContact.created_at || new Date().toISOString(),
        updated_at: cloudContact.updatedAt || cloudContact.updated_at || cloudContact.createdAt || cloudContact.created_at || new Date().toISOString(),
      });
    }

    const db = await this.ensureDb();
    const merged = {
      ...existing,
      ...contactData,
      displayName: contactData.displayName || existing.displayName,
      phones: this.mergeContactValues(existing.phones, contactData.phones),
      emails: this.mergeContactValues(existing.emails, contactData.emails),
      normalizedPhones: Array.from(new Set([...(existing.normalizedPhones || []), ...normalizedPhones])),
      normalizedEmails: Array.from(new Set([...(existing.normalizedEmails || []), ...normalizedEmails])),
      sourceCaptureIds: Array.from(new Set([...(existing.sourceCaptureIds || []), ...contactData.sourceCaptureIds])),
      updated_at: cloudContact.updatedAt || cloudContact.updated_at || existing.updated_at,
    };

    return new Promise((resolve, reject) => {
      const request = db.transaction([CONTACTS_STORE], 'readwrite').objectStore(CONTACTS_STORE).put(merged);
      request.onsuccess = () => resolve(merged);
      request.onerror = () => reject(new Error('Failed to save cloud contact'));
    });
  }

  async upsertCloudPerson(cloudPerson) {
    return this.upsertCloudContact(cloudPerson);
  }

  // ─── Locations ──────────────────────────────────────────────────────────

  normalizeLocationDraft(location = {}) {
    const displayName = normalizeLocationText(
      location.displayName || location.display_name || location.placeText || location.place_text || location.addressText || location.address_text
    );
    if (!displayName) return null;

    return {
      id: location.id || location.localId || location.local_id || null,
      displayName,
      placeText: normalizeLocationText(location.placeText || location.place_text || displayName),
      addressText: normalizeLocationText(location.addressText || location.address_text || ''),
      latitude: location.latitude ?? null,
      longitude: location.longitude ?? null,
      providerPlaceId: location.providerPlaceId || location.provider_place_id || null,
      created_at: location.created_at || null,
    };
  }

  async getLocations(status = 'confirmed') {
    const db = await this.ensureDb();
    const aliases = await this.getLocationAliases();
    return new Promise((resolve, reject) => {
      const store = db.transaction([LOCATIONS_STORE], 'readonly').objectStore(LOCATIONS_STORE);
      const normalizedStatus = status === 'confirmed' ? 'active' : status;
      const req = normalizedStatus === 'active' ? store.getAll() : (normalizedStatus ? store.index('status').getAll(normalizedStatus) : store.getAll());
      req.onsuccess = () => {
        const aliasMap = new Map(aliases.map(alias => [alias.fromClientId, alias.toClientId]));
        const byId = new Map((req.result || []).map(location => [location.id, location]));
        const rows = (req.result || [])
          .filter(location => normalizedStatus !== 'active' || isActiveLocationStatus(location.status))
          .filter(location => !(aliasMap.has(location.id) && byId.has(aliasMap.get(location.id))));
        rows.sort((a, b) => new Date(b.updated_at || b.created_at) - new Date(a.updated_at || a.created_at));
        resolve(rows);
      };
      req.onerror = () => reject(new Error('Failed to fetch locations'));
    });
  }

  async getLocation(locationId) {
    const db = await this.ensureDb();
    const aliasMap = new Map((await this.getLocationAliases()).map(alias => [alias.fromClientId, alias.toClientId]));
    return new Promise((resolve, reject) => {
      const store = db.transaction([LOCATIONS_STORE], 'readonly').objectStore(LOCATIONS_STORE);
      const load = (id, seen = new Set()) => {
        const aliasTarget = aliasMap.get(id);
        if (aliasTarget && !seen.has(id)) {
          seen.add(id);
          load(aliasTarget, seen);
          return;
        }
        const request = store.get(id);
        request.onsuccess = () => {
          if (request.result) {
            resolve(request.result);
            return;
          }
          if (!aliasTarget || seen.has(id)) {
            resolve(null);
            return;
          }
          seen.add(id);
          load(aliasTarget, seen);
        };
        request.onerror = () => reject(new Error('Failed to fetch location'));
      };
      load(locationId);
    });
  }

  async createLocation(locationData) {
    const normalized = this.normalizeLocationDraft(locationData);
    if (!normalized) throw new Error('Location needs a name or address');

    const existingLocations = await this.getLocations('confirmed');
    const reusableLocation = findReusableLocation(existingLocations, normalized);
    if (reusableLocation) {
      return { location: reusableLocation, reused: true };
    }

    const db = await this.ensureDb();
    const now = new Date().toISOString();
    const location = {
      ...normalized,
      id: this.generateLocationId(),
      status: 'active',
      normalizedDisplayName: normalizeLocationKey(normalized.displayName),
      syncStatus: 'pending',
      synced_at: null,
      source: locationData.source || 'manual',
      providerPlaceId: locationData.providerPlaceId || null,
      lookupEvidence: compactPayload(locationData.lookupEvidence || {}),
      created_at: now,
      updated_at: now,
    };

    return new Promise((resolve, reject) => {
      const request = db.transaction([LOCATIONS_STORE], 'readwrite').objectStore(LOCATIONS_STORE).add(location);
      request.onsuccess = () => resolve({ location, reused: false });
      request.onerror = () => reject(new Error('Failed to create location'));
    });
  }

  async updateLocation(locationId, updates = {}) {
    const db = await this.ensureDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction([LOCATIONS_STORE], 'readwrite');
      const store = tx.objectStore(LOCATIONS_STORE);
      const request = store.get(locationId);

      request.onsuccess = () => {
        const location = request.result;
        if (!location) {
          reject(new Error('Location not found'));
          return;
        }

        const updated = {
          ...location,
          ...updates,
          id: location.id,
          normalizedDisplayName: updates.displayName ? normalizeLocationKey(updates.displayName) : location.normalizedDisplayName,
          syncStatus: 'pending',
          providerPlaceId: updates.providerPlaceId || location.providerPlaceId || null,
          lookupEvidence: compactPayload(updates.lookupEvidence || location.lookupEvidence || {}),
          updated_at: new Date().toISOString(),
        };
        const put = store.put(updated);
        put.onsuccess = () => resolve(updated);
        put.onerror = () => reject(new Error('Failed to update location'));
      };

      request.onerror = () => reject(new Error('Failed to fetch location'));
    });
  }

  async getEntriesForLocation(locationId) {
    const location = await this.getLocation(locationId);
    if (!location) return [];

    const entries = await this.getEntries('confirmed');
    return entries.filter(entry => entryMatchesLocation(entry, location));
  }

  async getLocationsUnsynced() {
    const locations = await this.getLocationsForReplica();
    return locations.filter(location => location.syncStatus !== 'synced');
  }

  async getLocationsForReplica() {
    const db = await this.ensureDb();
    const aliases = await this.getLocationAliases();
    return new Promise((resolve, reject) => {
      const store = db.transaction([LOCATIONS_STORE], 'readonly').objectStore(LOCATIONS_STORE);
      const request = store.getAll();
      request.onsuccess = () => {
        const aliasMap = new Map(aliases.map(alias => [alias.fromClientId, alias.toClientId]));
        const byId = new Map((request.result || []).map(location => [location.id, location]));
        const locations = (request.result || [])
          .filter(location => ['active', 'archived', 'confirmed'].includes(location.status || 'active'))
          .filter(location => !(aliasMap.has(location.id) && byId.has(aliasMap.get(location.id))));
        resolve(locations);
      };
      request.onerror = () => reject(new Error('Failed to fetch locations for replica'));
    });
  }

  async getLocationsForEntry(entryId) {
    const db = await this.ensureDb();
    const aliasMap = new Map((await this.getLocationAliases()).map(alias => [alias.fromClientId, alias.toClientId]));
    return new Promise((resolve, reject) => {
      const tx = db.transaction([ENTRY_LOCATIONS_STORE, LOCATIONS_STORE], 'readonly');
      const linksReq = tx.objectStore(ENTRY_LOCATIONS_STORE).index('entryId').getAll(entryId);
      linksReq.onsuccess = () => {
        const links = linksReq.result || [];
        if (links.length === 0) {
          resolve([]);
          return;
        }
        const locations = [];
        let remaining = links.length;
        const aliasesSeen = [];
        const finishWithAlias = (link, location) => {
          if (location) locations.push(location);
          remaining -= 1;
          if (remaining === 0) resolve(locations);
        };
        const loadLocation = (link, locationId) => {
          const resolvedLocationId = aliasMap.get(locationId) || locationId;
          const locationReq = tx.objectStore(LOCATIONS_STORE).get(resolvedLocationId);
          locationReq.onsuccess = () => {
            if (locationReq.result) {
              finishWithAlias(link, locationReq.result);
              return;
            }
            const toClientId = aliasMap.get(locationId);
            if (!toClientId || aliasesSeen.includes(locationId)) {
              finishWithAlias(link, null);
              return;
            }
            aliasesSeen.push(locationId);
            loadLocation(link, toClientId);
          };
          locationReq.onerror = () => reject(new Error('Failed to fetch entry location'));
        };
        for (const link of links) loadLocation(link, link.locationId);
      };
      linksReq.onerror = () => reject(new Error('Failed to fetch entry location links'));
    });
  }

  async markLocationSynced(locationId) {
    const db = await this.ensureDb();
    return new Promise((resolve, reject) => {
      const store = db.transaction([LOCATIONS_STORE], 'readwrite').objectStore(LOCATIONS_STORE);
      const req = store.get(locationId);
      req.onsuccess = () => {
        const location = req.result;
        if (!location) { reject(new Error('Location not found')); return; }
        location.syncStatus = 'synced';
        location.synced_at = new Date().toISOString();
        const put = store.put(location);
        put.onsuccess = () => resolve(location);
        put.onerror = () => reject(new Error('Failed to mark location synced'));
      };
      req.onerror = () => reject(new Error('Failed to fetch location'));
    });
  }

  async upsertCloudLocation(cloudLocation) {
    const db = await this.ensureDb();
    const locationId = cloudLocation.id;
    const existing = locationId ? await this.getLocation(locationId) : null;
    const incomingUpdatedAt = cloudLocation.updatedAt || cloudLocation.updated_at || cloudLocation.createdAt || cloudLocation.created_at || null;
    if (
      existing?.syncStatus === 'pending' &&
      new Date(existing.updated_at || 0) > new Date(incomingUpdatedAt || 0)
    ) {
      return existing;
    }

    const locationData = {
      id: locationId || existing?.id || this.generateLocationId(),
      displayName: cloudLocation.displayName || '',
      placeText: cloudLocation.placeText || cloudLocation.displayName || '',
      addressText: cloudLocation.addressText || '',
      latitude: cloudLocation.latitude ?? null,
      longitude: cloudLocation.longitude ?? null,
      status: normalizeLocationStatus(cloudLocation.status),
      normalizedDisplayName: normalizeLocationKey(cloudLocation.displayName || cloudLocation.placeText || ''),
      syncStatus: 'synced',
      synced_at: new Date().toISOString(),
      providerPlaceId: cloudLocation.providerPlaceId || existing?.providerPlaceId || null,
      created_at: cloudLocation.createdAt || new Date().toISOString(),
      updated_at: cloudLocation.updatedAt || cloudLocation.createdAt || new Date().toISOString(),
    };

    return new Promise((resolve, reject) => {
      const store = db.transaction([LOCATIONS_STORE], 'readwrite').objectStore(LOCATIONS_STORE);
      const req = store.put(locationData);
      req.onsuccess = () => resolve(locationData);
      req.onerror = () => reject(new Error('Failed to save cloud location'));
    });
  }

  // ─── Tags ───────────────────────────────────────────────────────────────

  normalizeTagDraft(tag = {}) {
    const validation = validateTagLabel(tag.label || tag.name || tag.displayName || tag);
    if (!validation.valid) return null;
    const categoryName = normalizeTagLabel(tag.categoryName || tag.category_name || DEFAULT_TAG_CATEGORY.name) || DEFAULT_TAG_CATEGORY.name;
    const categoryId = tag.categoryId || tag.category_id || `tag-category-${safeLocalKey(categoryName)}`;

    return {
      id: tag.id || tag.localId || tag.local_id || null,
      label: validation.label,
      categoryId,
      categoryName,
      remoteId: tag.remoteId || tag.remote_id || null,
      created_at: tag.created_at || null,
      useCount: tag.useCount || tag.use_count || 0,
      acceptedCount: tag.acceptedCount || tag.accepted_count || 0,
      rejectedCount: tag.rejectedCount || tag.rejected_count || 0,
    };
  }

  async getTags(status = 'confirmed') {
    const db = await this.ensureDb();
    return new Promise((resolve, reject) => {
      const store = db.transaction([TAGS_STORE], 'readonly').objectStore(TAGS_STORE);
      const req = status ? store.index('status').getAll(status) : store.getAll();
      req.onsuccess = () => {
        const rows = req.result || [];
        rows.sort((a, b) => String(a.label).localeCompare(String(b.label)));
        resolve(rows);
      };
      req.onerror = () => reject(new Error('Failed to fetch tags'));
    });
  }

  async getTagsForEntry(entryId) {
    const db = await this.ensureDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction([ENTRY_TAGS_STORE, TAGS_STORE], 'readonly');
      const linksReq = tx.objectStore(ENTRY_TAGS_STORE).index('entryId').getAll(entryId);
      linksReq.onsuccess = () => {
        const links = linksReq.result || [];
        if (links.length === 0) {
          resolve([]);
          return;
        }
        const tags = [];
        let remaining = links.length;
        for (const link of links) {
          const tagReq = tx.objectStore(TAGS_STORE).get(link.tagId);
          tagReq.onsuccess = () => {
            if (tagReq.result) tags.push(tagReq.result);
            remaining -= 1;
            if (remaining === 0) resolve(tags);
          };
          tagReq.onerror = () => reject(new Error('Failed to fetch entry tag'));
        }
      };
      linksReq.onerror = () => reject(new Error('Failed to fetch entry tag links'));
    });
  }

  // ─── Feedback ────────────────────────────────────────────────────────────

  async createFeedback(meta, audioBlob) {
    const db = await this.ensureDb();
    const item = {
      id: `fb-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      audioBlob,
      audioSize: audioBlob.size,
      audioDuration: meta.duration,
      diagnosticBundle: meta.diagnosticBundle || null,
      triage: meta.triage || null,
      status: 'recording',
      syncStatus: 'pending',
      errorMessage: null,
      transcript: null,
      created_at: new Date().toISOString(),
      synced_at: null,
    };
    return new Promise((resolve, reject) => {
      const tx = db.transaction([FEEDBACK_STORE], 'readwrite');
      tx.objectStore(FEEDBACK_STORE).add(item).onsuccess = () => resolve(item.id);
      tx.onerror = () => reject(new Error('Failed to create feedback'));
    });
  }

  async createFeedbackTextReport({ transcript, diagnosticBundle, triage }) {
    const db = await this.ensureDb();
    const item = {
      id: `fb-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      audioBlob: null,
      audioSize: 0,
      audioDuration: 0,
      diagnosticBundle: diagnosticBundle || null,
      triage: triage || null,
      status: 'ready_for_review',
      syncStatus: 'pending',
      errorMessage: null,
      transcript,
      created_at: new Date().toISOString(),
      synced_at: null,
    };
    return new Promise((resolve, reject) => {
      const tx = db.transaction([FEEDBACK_STORE], 'readwrite');
      tx.objectStore(FEEDBACK_STORE).add(item).onsuccess = () => resolve(item.id);
      tx.onerror = () => reject(new Error('Failed to create feedback'));
    });
  }

  async getFeedbackItem(id) {
    const db = await this.ensureDb();
    return new Promise((resolve, reject) => {
      const req = db.transaction([FEEDBACK_STORE], 'readonly').objectStore(FEEDBACK_STORE).get(id);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(new Error('Failed to fetch feedback item'));
    });
  }

  async getFeedbackItems(status = null) {
    const db = await this.ensureDb();
    return new Promise((resolve, reject) => {
      const store = db.transaction([FEEDBACK_STORE], 'readonly').objectStore(FEEDBACK_STORE);
      const req = status ? store.index('status').getAll(status) : store.getAll();
      req.onsuccess = () => {
        const items = req.result.map(f => ({ ...f, audioBlob: undefined }));
        items.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
        resolve(items);
      };
      req.onerror = () => reject(new Error('Failed to fetch feedback items'));
    });
  }

  async updateFeedbackWithTranscript(id, transcript) {
    const db = await this.ensureDb();
    return new Promise((resolve, reject) => {
      const store = db.transaction([FEEDBACK_STORE], 'readwrite').objectStore(FEEDBACK_STORE);
      const req = store.get(id);
      req.onsuccess = () => {
        const item = req.result;
        if (!item) { reject(new Error('Feedback item not found')); return; }
        item.transcript = transcript;
        item.errorMessage = null;
        item.status = 'ready_for_review';
        const put = store.put(item);
        put.onsuccess = () => resolve(item);
        put.onerror = () => reject(new Error('Failed to update feedback'));
      };
      req.onerror = () => reject(new Error('Failed to fetch feedback item'));
    });
  }

  async updateFeedback(id, updates) {
    const db = await this.ensureDb();
    return new Promise((resolve, reject) => {
      const store = db.transaction([FEEDBACK_STORE], 'readwrite').objectStore(FEEDBACK_STORE);
      const req = store.get(id);
      req.onsuccess = () => {
        const item = req.result;
        if (!item) { reject(new Error('Feedback item not found')); return; }
        Object.assign(item, updates);
        const put = store.put(item);
        put.onsuccess = () => resolve(item);
        put.onerror = () => reject(new Error('Failed to update feedback'));
      };
      req.onerror = () => reject(new Error('Failed to fetch feedback item'));
    });
  }

  async confirmFeedback(id) {
    const db = await this.ensureDb();
    return new Promise((resolve, reject) => {
      const store = db.transaction([FEEDBACK_STORE], 'readwrite').objectStore(FEEDBACK_STORE);
      const req = store.get(id);
      req.onsuccess = () => {
        const item = req.result;
        if (!item) { reject(new Error('Feedback item not found')); return; }
        item.audioBlob = null;
        item.status = 'confirmed';
        item.syncStatus = 'pending';
        const put = store.put(item);
        put.onsuccess = () => resolve(item);
        put.onerror = () => reject(new Error('Failed to confirm feedback'));
      };
      req.onerror = () => reject(new Error('Failed to fetch feedback item'));
    });
  }

  async rejectFeedback(id) {
    const db = await this.ensureDb();
    return new Promise((resolve, reject) => {
      const req = db.transaction([FEEDBACK_STORE], 'readwrite').objectStore(FEEDBACK_STORE).delete(id);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(new Error('Failed to delete feedback'));
    });
  }

  async markFeedbackSynced(id) {
    const db = await this.ensureDb();
    return new Promise((resolve, reject) => {
      const store = db.transaction([FEEDBACK_STORE], 'readwrite').objectStore(FEEDBACK_STORE);
      const req = store.get(id);
      req.onsuccess = () => {
        const item = req.result;
        if (!item) { reject(new Error('Feedback item not found')); return; }
        item.syncStatus = 'synced';
        item.synced_at = new Date().toISOString();
        const put = store.put(item);
        put.onsuccess = () => resolve(item);
        put.onerror = () => reject(new Error('Failed to mark feedback synced'));
      };
      req.onerror = () => reject(new Error('Failed to fetch feedback item'));
    });
  }

  async markFeedbackFailed(id, errorMessage) {
    const db = await this.ensureDb();
    return new Promise((resolve, reject) => {
      const store = db.transaction([FEEDBACK_STORE], 'readwrite').objectStore(FEEDBACK_STORE);
      const req = store.get(id);
      req.onsuccess = () => {
        const item = req.result;
        if (!item) { reject(new Error('Feedback item not found')); return; }
        item.status = 'failed';
        item.errorMessage = errorMessage;
        const put = store.put(item);
        put.onsuccess = () => resolve(item);
        put.onerror = () => reject(new Error('Failed to mark feedback failed'));
      };
      req.onerror = () => reject(new Error('Failed to fetch feedback item'));
    });
  }

  async resetFeedbackForRetry(id) {
    const db = await this.ensureDb();
    return new Promise((resolve, reject) => {
      const store = db.transaction([FEEDBACK_STORE], 'readwrite').objectStore(FEEDBACK_STORE);
      const req = store.get(id);
      req.onsuccess = () => {
        const item = req.result;
        if (!item) { reject(new Error('Feedback item not found')); return; }
        item.status = 'recording';
        item.errorMessage = null;
        const put = store.put(item);
        put.onsuccess = () => resolve(item);
        put.onerror = () => reject(new Error('Failed to reset feedback'));
      };
      req.onerror = () => reject(new Error('Failed to fetch feedback item'));
    });
  }

  // ─── Queries ────────────────────────────────────────────────────────────

  /**
   * Save a query to the queries table. Deduplicates by text.
   * @param {string} text - The query text
   * @param {string} [createdAt] - Optional ISO timestamp (for server sync)
   * @param {boolean} [isSynced] - Whether already synced to server
   * @returns {Promise<string>} Query ID
   */
  async saveQuery(text, createdAt, isSynced) {
    const db = await this.ensureDb();
    const now = new Date().toISOString();

    // Check for existing query with same text
    const existing = await this.findQueryByText(text);
    if (existing) {
      // Update created_at to bubble to top
      return this.updateQuery(existing.id, {
        created_at: createdAt || now,
      });
    }

    const query = {
      id: `query-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      text,
      syncStatus: isSynced ? 'synced' : 'pending',
      created_at: createdAt || now,
      synced_at: isSynced ? now : null,
    };

    return new Promise((resolve, reject) => {
      const transaction = db.transaction([QUERIES_STORE], 'readwrite');
      const store = transaction.objectStore(QUERIES_STORE);
      const request = store.add(query);

      request.onsuccess = () => resolve(query.id);
      request.onerror = () => reject(new Error('Failed to save query'));
    });
  }

  /**
   * Find a query by text
   */
  async findQueryByText(text) {
    const queries = await this.getQueries();
    return queries.find(q => q.text === text) || null;
  }

  /**
   * Update a query by ID
   */
  async updateQuery(queryId, updates) {
    const db = await this.ensureDb();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction([QUERIES_STORE], 'readwrite');
      const store = transaction.objectStore(QUERIES_STORE);
      const getRequest = store.get(queryId);

      getRequest.onsuccess = () => {
        const query = getRequest.result;
        if (!query) { reject(new Error('Query not found')); return; }
        Object.assign(query, updates);
        const put = store.put(query);
        put.onsuccess = () => resolve(query.id);
        put.onerror = () => reject(new Error('Failed to update query'));
      };
      getRequest.onerror = () => reject(new Error('Failed to fetch query'));
    });
  }

  /**
   * Mark a query as synced
   */
  async markQuerySynced(text) {
    const query = await this.findQueryByText(text);
    if (query) {
      await this.updateQuery(query.id, {
        syncStatus: 'synced',
        synced_at: new Date().toISOString(),
      });
    }
  }

  /**
   * Get up to `limit` queries, most recent first
   */
  async getQueries(limit = 50) {
    const db = await this.ensureDb();

    return new Promise((resolve, reject) => {
      const transaction = db.transaction([QUERIES_STORE], 'readonly');
      const store = transaction.objectStore(QUERIES_STORE);
      const request = store.getAll();

      request.onsuccess = () => {
        const queries = request.result
          .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
          .slice(0, limit);
        resolve(queries);
      };

      request.onerror = () => reject(new Error('Failed to fetch queries'));
    });
  }

  /**
   * Clear all data (for testing)
   */
  async clearAll() {
    const db = await this.ensureDb();

    return new Promise((resolve, reject) => {
      const storeNames = Array.from(db.objectStoreNames);
      const transaction = db.transaction(storeNames, 'readwrite');
      for (const storeName of storeNames) {
        transaction.objectStore(storeName).clear();
      }

      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(new Error('Failed to clear database'));
    });
  }
}

// Singleton instance
export const dbService = new DBService();

// Initialize on import
if (typeof indexedDB !== 'undefined') {
  dbService.init().catch(console.error);
}
